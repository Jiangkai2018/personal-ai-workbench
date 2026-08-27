// Agent 板块路由：会话 CRUD + /chat 流式对话（AI SDK UI Message Stream over SSE）
import { Router } from 'express'
import {
  convertToModelMessages,
  createUIMessageStream,
  pipeUIMessageStreamToResponse,
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
import type { AgentThread, ModelSelection } from '../../agent/types'

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

  // 改标题 / 归档（侧栏重命名用）
  router.patch('/threads/:id', async (req, res, next) => {
    try {
      const patch = z.object({ title: z.string().min(1).max(60), archived: z.boolean() }).partial().parse(req.body)
      const thread = await deps.threads.get(req.params.id)
      if (!thread) return void res.status(404).json({ error: 'NOT_FOUND', message: '会话不存在' })
      await deps.threads.save({ ...thread, ...patch })
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
      })
    } catch (err) {
      next(err)
    }
  })

  // ── 流式对话主体 ───────────────────────────────────
  router.post('/chat', async (req, res, next) => {
    let parsed: z.infer<typeof chatSchema>
    let thread: AgentThread | null
    let resolvedModel: Awaited<ReturnType<AgentModelResolver>>
    try {
      parsed = chatSchema.parse(req.body)
      thread = await deps.threads.get(parsed.id)
      if (!thread) thread = await deps.threads.create(parsed.id)

      // 解析模型放在流启动之前：错误还能走全局 JSON 错误处理（503）
      resolvedModel = await deps.resolveModel(parsed.selectedModel as ModelSelection | undefined)
    } catch (err) {
      return next(err)
    }

    const messages = parsed.messages as unknown as UIMessage[]
    const controller = new AbortController()
    // 客户端异常断开才中止：Node ≥16 的 req 'close' 在响应正常结束后也会触发，
    // 无条件 abort 会在流收尾瞬间打断 createUIMessageStream 的合并与落盘（bug082702-4 家族）。
    // 判据：响应尚未 writableEnded 却收到 close = 连接被对端提前切断。
    req.on('close', () => {
      if (!res.writableEnded) {
        console.warn(`[agent] 客户端断开，中止会话流: ${parsed.id}`)
        controller.abort()
      }
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
        const current = await deps.threads.get(parsed.id)
        if (!current) return
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
      },
    })

    pipeUIMessageStreamToResponse({ response: res, stream: uiStream })
  })

  return router
}
