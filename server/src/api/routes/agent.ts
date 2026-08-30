// Agent 板块路由：会话 CRUD + /chat 流式对话（AI SDK UI Message Stream over SSE）
// 0828-01 §3（ADR-0008 会话即长任务）：开启推送的运行断连不中止，跑完落盘后发钉钉推送。
import { Router } from 'express'
import {
  convertToModelMessages,
  createUIMessageStream,
  JsonToSseTransformStream,
  stepCountIs,
  streamText,
} from 'ai'
import type { UIMessage } from 'ai'
import path from 'node:path'
import { z } from 'zod'
import { ThreadStore } from '../../agent/threadStore'
import type { AgentModelResolver } from '../../agent/modelResolver'
import { maskProviders, loadAgentConfig } from '../../agent/providerConfig'
import { getWebSearchTools } from '../../agent/webSearch'
import { buildKbSystemPrompt, createKbToolset, DEFAULT_KB_DENY } from '../../agent/kbTools'
import { RunRegistry } from '../../agent/runRegistry'
import { buildCompletionMessage, sendDingtalk } from '../../agent/notify'
import type { AgentThread, ModelSelection } from '../../agent/types'

/** 全局后台运行上限（§3.2）：开启推送的提交超限直接拒绝 */
const BG_RUN_LIMIT = 3

// 消息结构宽松校验：parts 内部由 AI SDK 自行解析，落盘原样保留
const uiMessageSchema = z
  .object({
    id: z.string(),
    role: z.enum(['user', 'assistant', 'system']),
    parts: z.array(z.any()).default([]),
  })
  .passthrough()

const chatSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  messages: z.array(uiMessageSchema).min(1),
  selectedModel: z
    .object({ providerId: z.string(), model: z.string() })
    .partial()
    .optional(),
})

function deriveTitle(thread: AgentThread): string {
  if (thread.title !== '新对话') return thread.title
  for (const m of thread.messages) {
    if (m.role !== 'user') continue
    const text = m.parts.find((p) => p.type === 'text')?.text ?? ''
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean) return clean.slice(0, 24)
  }
  return '新对话'
}

export function agentRouter(deps: { threads: ThreadStore; resolveModel: AgentModelResolver; dataDir: string }): Router {
  const router = Router()
  // 内存运行表：会话互斥 + 全局后台名额 + 手动停止打标（进程重启即清空，v1 接受）
  const registry = new RunRegistry(BG_RUN_LIMIT)
  /** threadId → 本轮 AbortController（stop 端点用） */
  const stateControllers = new Map<string, AbortController>()

  // ── 会话列表（元信息） ──────────────────────────────
  router.get('/threads', async (_req, res, next) => {
    try {
      res.json(await deps.threads.listMeta())
    } catch (err) {
      next(err)
    }
  })

  // 建号式建会话：前端生成 id 先占位，首个消息进来时再落正文
  router.post('/threads', async (req, res, next) => {
    try {
      const { id } = z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional() }).parse(req.body ?? {})
      res.status(201).json(await deps.threads.create(id))
    } catch (err) {
      next(err)
    }
  })

  router.get('/threads/:id', async (req, res, next) => {
    try {
      const thread = await deps.threads.get(req.params.id)
      if (!thread) return void res.status(404).json({ error: 'NOT_FOUND', message: '会话不存在' })
      res.json(thread)
    } catch (err) {
      next(err)
    }
  })

  // 改标题 / 归档 / 完成推送开关（侧栏与输入区用）
  router.patch('/threads/:id', async (req, res, next) => {
    try {
      const patch = z
        .object({ title: z.string().min(1).max(60), archived: z.boolean(), pushOnCompletion: z.boolean() })
        .partial()
        .parse(req.body)
      const thread = await deps.threads.get(req.params.id)
      if (!thread) return void res.status(404).json({ error: 'NOT_FOUND', message: '会话不存在' })
      await deps.threads.save({ ...thread, ...patch })
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ── 运行状态 / 手动停止（0828-01 §3.1–3.2） ────────
  router.get('/threads/:id/status', async (req, res, next) => {
    try {
      const state = registry.state(req.params.id)
      res.json(state ? { running: true, startedAt: new Date(state.startedAt).toISOString(), push: state.push } : { running: false })
    } catch (err) {
      next(err)
    }
  })

  router.post('/threads/:id/stop', async (req, res, next) => {
    try {
      const state = registry.state(req.params.id)
      if (!state) return void res.status(404).json({ error: 'NOT_RUNNING', message: '该会话没有正在后台运行的任务' })
      const controller = stateControllers.get(req.params.id)
      state.manualStop = true
      controller?.abort()
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  router.delete('/threads/:id', async (req, res, next) => {
    try {
      const ok = await deps.threads.remove(req.params.id)
      if (!ok) return void res.status(404).json({ error: 'NOT_FOUND', message: '会话不存在' })
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // ── 可选厂商清单（给将来的模型选择器 / 后台页） ─────
  router.get('/models', async (_req, res, next) => {
    try {
      const config = await loadAgentConfig(deps.dataDir)
      res.json({
        providers: config ? maskProviders(config.providers) : [],
        defaultModel: config?.defaultModel ?? null,
        // 钉钉推送是否可用（只给布尔，webhook/secret 不出配置文件 §3.3）
        notifyEnabled: !!(config?.notify?.dingtalk?.enabled && config.notify.dingtalk.webhook),
      })
    } catch (err) {
      next(err)
    }
  })

  // ── 流式对话主体 ───────────────────────────────────
  router.post('/chat', async (req, res, next) => {
    let parsed: z.infer<typeof chatSchema> | undefined
    let thread: AgentThread | null
    let resolvedModel: Awaited<ReturnType<AgentModelResolver>>
    let pushEnabled = false
    try {
      parsed = chatSchema.parse(req.body)
      thread = await deps.threads.get(parsed.id)
      if (!thread) thread = await deps.threads.create(parsed.id)
      pushEnabled = !!thread.pushOnCompletion

      // 运行占位：同会话互斥 / 后台名额（0828-01 §3.2）；失败在解析模型之前拒绝（省成本）
      const started = registry.start(parsed.id, pushEnabled)
      if (started === 'busy') {
        return void res.status(409).json({ error: 'RUNNING', message: '上一轮还在后台运行，请稍候或先停止' })
      }
      if (started === 'limit') {
        return void res.status(429).json({ error: 'BG_LIMIT', message: `后台运行已达上限（${BG_RUN_LIMIT} 个），请稍后再试` })
      }

      // 解析模型放在流启动之前：错误还能走全局 JSON 错误处理（503）
      resolvedModel = await deps.resolveModel(parsed.selectedModel as ModelSelection | undefined)
    } catch (err) {
      if (parsed?.id) registry.finish(parsed.id)
      return next(err)
    }

    const messages = parsed.messages as unknown as UIMessage[]
    const controller = new AbortController()
    stateControllers.set(parsed.id, controller)
    let clientGone = false
    // 客户端异常断开才中止：Node ≥16 的 req 'close' 在响应正常结束后也会触发，
    // 无条件 abort 会在流收尾瞬间打断 createUIMessageStream 的合并与落盘（bug082702-4 家族）。
    // 判据：响应尚未 writableEnded 却收到 close = 连接被对端提前切断。
    // 开了「完成后推送」的运行例外：断连不中止，服务端继续跑完 → 落盘 → 推送（ADR-0008）。
    // 挂在 res 上（而非 req）：res 'close' = 响应完成或底层连接提前终止（req 'close' 只表意请求体完成，
    // 客户端在读响应阶段断开时它不触发 —— 单测实测踩坑）。
    res.on('close', () => {
      if (res.writableEnded) return
      clientGone = true
      if (pushEnabled) {
        console.warn(`[agent] 客户端断开，转入后台续跑: ${parsed.id}`)
        res.on('error', () => {}) // 后续写死连接的错误吞掉，不致崩进程
        return
      }
      console.warn(`[agent] 客户端断开，中止会话流: ${parsed.id}`)
      controller.abort()
    })

    // 输出配额必须显式给足（bug082702-4）：@ai-sdk/anthropic 对未知模型名钳默认 4096，
    // GLM 这类思考型模型的 thinking 会把配额烧光 → finishReason=length、正文零字落盘，
    // 前端表现为永远「思考中」。可用 WORKBENCH_AGENT_MAX_TOKENS 覆盖。
    const maxOutputTokens = Number(process.env.WORKBENCH_AGENT_MAX_TOKENS || 32768)

    // 工具集（0827-03）：知识库文件工具（读写改/查找/目录树/网页抓取）+ 联网搜索 MCP。
    // kb 工具本地执行零依赖；搜索拿不到（未配 Key/关闭/连接失败）时返回空对象，等价于现状不阻塞。
    const agentConfig = await loadAgentConfig(deps.dataDir).catch(() => null)
    const kbRoot = path.join(deps.dataDir, 'knowledge')
    const kbTools = createKbToolset({
      root: kbRoot,
      deny: agentConfig?.fileTools?.deny ?? DEFAULT_KB_DENY,
    })
    const searchTools = await getWebSearchTools(deps.dataDir, () => loadAgentConfig(deps.dataDir))
    const tools = { ...searchTools, ...kbTools }

    // 归位规则注入：README.md（目录地图/铁律）+ CLAUDE.md（归位规则）随 system 下发；
    // 文件缺失（如 e2e 临时库）时对应段落自动省略，不阻塞对话。
    const system = await buildKbSystemPrompt(kbRoot)

    const result = streamText({
      model: resolvedModel,
      system,
      messages: await convertToModelMessages(messages),
      abortSignal: controller.signal,
      maxOutputTokens,
      tools,
      // 工具调用后允许模型继续生成最终回答（无工具轮次该参数零影响）；
      // 「调研→整合→落盘」全链路约 7-9 步，上限放宽到 20（WORKBENCH_AGENT_MAX_STEPS 可覆盖）。
      stopWhen: stepCountIs(Number(process.env.WORKBENCH_AGENT_MAX_STEPS || 20)),
    })

    const uiStream = createUIMessageStream({
      originalMessages: messages,
      onError: (error) => (error instanceof Error ? error.message : String(error)),
      execute: ({ writer }) => writer.merge(result.toUIMessageStream()),
      onEnd: async ({ messages: merged }) => {
        try {
          // 现状语义保留（§3.1）：未开开关 + 客户端已断开 → 与旧行为一致，不落盘
          if (!pushEnabled && clientGone) return
          const current = await deps.threads.get(parsed.id)
          if (current) {
            current.messages = merged
            current.title = deriveTitle(current)
            current.model =
              parsed.selectedModel?.providerId && parsed.selectedModel?.model
                ? { providerId: parsed.selectedModel.providerId, model: parsed.selectedModel.model }
                : undefined
            try {
              current.usage = await result.totalUsage
            } catch {
              // 中断时拿不到用量，不影响落盘
            }
            await deps.threads.save(current)

            // 完成推送（§3.3/§3.4）：开启开关且非手动停止才推；推送失败不影响会话落盘
            const state = registry.state(parsed.id)
            if (state?.push && !state.manualStop) {
              await fireCompletionPush(parsed.id, current, state.startedAt, merged)
            }
          }
        } finally {
          registry.finish(parsed.id)
          stateControllers.delete(parsed.id)
        }
      },
    })

    // SSE 泵送：手动从 UI 流读块写响应。不用 pipeUIMessageStreamToResponse 的原因（ADR-0008）：
    // 它在连接死亡时会 abort/cancel 整条 UI 流 → onEnd 不执行 → 落盘与推送全部丢失。
    // 手动泵送让流的存活与连接解耦：断连后服务端照常跑完 → 落盘 → 推送。
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const sse = uiStream.pipeThrough(new JsonToSseTransformStream())
    void (async () => {
      const reader = sse.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (!res.destroyed && !res.writableEnded) res.write(value)
        }
      } catch {
        // 模型/流异常：onEnd 仍会执行（错误以 error part 进流）
      } finally {
        if (!res.destroyed && !res.writableEnded) res.end()
      }
    })()
  })

  return router

  /** 组装并发送完成推送；只记日志不抛错（§3.4 推送失败重试后放弃，不阻塞不回滚） */
  async function fireCompletionPush(threadId: string, thread: AgentThread, startedAt: number, merged: UIMessage[]) {
    const config = await loadAgentConfig(deps.dataDir).catch(() => null)
    const ding = config?.notify?.dingtalk
    if (!ding?.enabled || !ding.webhook) return

    // 失败判定：本轮消息里有 error part（模型/工具错误会以 error part 落入流）
    const last = merged[merged.length - 1]
    const errorPart = last?.parts?.find((p) => (p as { type?: string }).type === 'error') as { errorText?: string } | undefined
    const failed = !!errorPart
    const summary = (last?.parts ?? [])
      .filter((p) => (p as { type?: string }).type === 'text')
      .map((p) => (p as { text?: string }).text ?? '')
      .join('')

    const message = buildCompletionMessage({
      title: thread.title,
      durationMs: Date.now() - startedAt,
      model: thread.model?.model ?? '未知模型',
      summary,
      threadId,
      baseUrl: ding.baseUrl,
      failed,
      error: errorPart?.errorText,
    })
    const result = await sendDingtalk(
      { enabled: true, webhook: ding.webhook, secret: ding.secret, baseUrl: ding.baseUrl },
      message,
    )
    if (!result.ok) console.warn(`[agent] 钉钉推送失败（不影响会话）: ${result.error}`)
  }
}
