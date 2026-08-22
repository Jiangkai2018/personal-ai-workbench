import { Router } from 'express'
import { z } from 'zod'
import type { EntityStore } from '../../storage/repo'

const goalStatus = z.enum(['active', 'paused', 'done', 'abandoned'])

const createGoalSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200),
  scope: z.enum(['personal', 'family']).default('personal'),
  track: z.enum(['growth', 'maintenance']).default('growth'),
  description: z.string().max(5000).default(''),
  milestones: z.array(z.string()).max(20).default([]),
  progress: z.number().min(0).max(100).default(0),
  status: goalStatus.default('active'),
})

const patchGoalSchema = createGoalSchema.partial()

export function goalRouter(store: EntityStore): Router {
  const router = Router()

  // 创建目标
  router.post('/', async (req, res, next) => {
    try {
      const parsed = createGoalSchema.parse(req.body)
      const goal = await store.create({
        type: 'goal',
        body: parsed.description,
        title: parsed.title,
        scope: parsed.scope,
        track: parsed.track,
        milestones: parsed.milestones,
        progress: parsed.progress,
        status: parsed.status,
      })
      res.status(201).json(goal)
    } catch (err) {
      next(err)
    }
  })

  // 列出目标（支持 ?scope=、?status= 过滤，最新在前）
  router.get('/', async (req, res, next) => {
    try {
      const goals = await store.list('goal')
      const scope = req.query.scope
      const status = req.query.status
      let filtered = goals
      if (scope === 'personal' || scope === 'family') filtered = filtered.filter((g) => g.scope === scope)
      if (typeof status === 'string') filtered = filtered.filter((g) => g.status === status)
      res.json(filtered)
    } catch (err) {
      next(err)
    }
  })

  // 更新目标（进度/里程碑/状态/标题/描述）
  router.patch('/:id', async (req, res, next) => {
    try {
      const parsed = patchGoalSchema.parse(req.body)
      const patch: Record<string, unknown> = { ...parsed }
      delete patch.description
      const updated = await store.update(
        'goal',
        req.params.id,
        patch,
        parsed.description !== undefined ? parsed.description : undefined,
      )
      if (!updated) {
        res.status(404).json({ error: 'NOT_FOUND' })
        return
      }
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  return router
}
