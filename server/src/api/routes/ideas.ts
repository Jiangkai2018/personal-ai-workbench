import { Router } from 'express'
import { z } from 'zod'
import type { EntityStore } from '../../storage/repo'
import type { Idea, Proposal } from '../../domain/types'

const createIdeaSchema = z.object({
  content: z.string().trim().min(1, '内容不能为空').max(2000),
  scope: z.enum(['personal', 'family']).default('personal'),
  track: z.enum(['growth', 'maintenance']).default('growth'),
})

const patchIdeaSchema = z
  .object({
    content: z.string().trim().min(1, '内容不能为空').max(2000).optional(),
    scope: z.enum(['personal', 'family']).optional(),
    track: z.enum(['growth', 'maintenance']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: '至少提供一个要修改的字段' })

export function ideaRouter(store: EntityStore): Router {
  const router = Router()

  // 捕获想法：写一个想法文件，状态 inbox。捕获成本为零。
  router.post('/', async (req, res, next) => {
    try {
      const parsed = createIdeaSchema.parse(req.body)
      const idea = await store.create({
        type: 'idea',
        status: 'inbox',
        body: parsed.content, // 想法正文即内容，写进 .md 文件体
        scope: parsed.scope,
        track: parsed.track,
      })
      res.status(201).json(idea)
    } catch (err) {
      next(err)
    }
  })

  // 想法收件箱
  router.get('/', async (req, res, next) => {
    try {
      const scope = req.query.scope
      const ideas = await store.list('idea')
      const filtered =
        scope === 'personal' || scope === 'family'
          ? ideas.filter((i) => i.scope === scope)
          : ideas
      res.json(filtered)
    } catch (err) {
      next(err)
    }
  })

  // 编辑想法：改正文/轨道/范围（后写覆盖，git 兜底）
  router.patch('/:id', async (req, res, next) => {
    try {
      const parsed = patchIdeaSchema.parse(req.body)
      const idea = await store.get<Idea>('idea', req.params.id)
      if (!idea) {
        res.status(404).json({ error: 'NOT_FOUND', message: '想法不存在' })
        return
      }
      const { content, ...front } = parsed
      const updated = await store.update<Idea>('idea', idea.id, front, content)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  // 删除想法：已转正（被机会引用）或存在待审提案时拒绝，避免断链
  router.delete('/:id', async (req, res, next) => {
    try {
      const idea = await store.get<Idea>('idea', req.params.id)
      if (!idea) {
        res.status(404).json({ error: 'NOT_FOUND', message: '想法不存在' })
        return
      }
      if (idea.promoted_to_id) {
        res.status(409).json({ error: 'ALREADY_PROMOTED', message: '该想法已转正为机会，不能删除' })
        return
      }
      const pending = (await store.list('proposal')) as Proposal[]
      if (pending.some((p) => p.source_id === idea.id && p.status === 'pending')) {
        res.status(409).json({
          error: 'PENDING_PROPOSAL',
          message: '该想法有待确认的转正提案，先到确认中心处理',
        })
        return
      }
      await store.remove('idea', idea.id)
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}
