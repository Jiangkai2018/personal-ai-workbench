// Agent 板块路由：会话 CRUD + /chat 流式对话（AI SDK UI Message Stream over SSE）
import { Router } from 'express'
import { convertToModelMessages, createUIMessageStream, pipeUIMessageStreamToResponse, streamText } from 'ai'
import type { UIMessage } from 'ai'
import { z } from 'zod'
import { ThreadStore } from '../../agent/threadStore'
import type { AgentModelResolver } from '../../agent/modelResolver'
import { maskProviders, loadAgentConfig } from '../../agent/providerConfig'
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
    req.on('close', () => controller.abort())

    const result = streamText({
      model: resolvedModel,
      messages: await convertToModelMessages(messages),
      abortSignal: controller.signal,
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
