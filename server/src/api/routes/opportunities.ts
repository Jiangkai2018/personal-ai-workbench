import { Router } from 'express'
import { z } from 'zod'
import type { EntityStore } from '../../storage/repo'
import type { Opportunity } from '../../domain/types'
import { scoreTotal, statusFor, type Scores } from '../../domain/opportunity'

const dimSchema = z.object({
  value: z.number().min(0).max(20).default(0),
  feasible: z.number().min(0).max(20).default(0),
  window: z.number().min(0).max(20).default(0),
  fit: z.number().min(0).max(20).default(0),
  risk: z.number().min(0).max(20).default(0),
})

const createOpportunitySchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200),
  scope: z.enum(['personal', 'family']).default('personal'),
  track: z.enum(['growth', 'maintenance']).default('growth'),
  scores: dimSchema.default({}),
  source_idea_id: z.string().optional(),
  note: z.string().max(2000).default(''),
})

const patchOpportunitySchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  scores: dimSchema.partial().optional(),
  source_idea_id: z.string().nullable().optional(),
  note: z.string().max(2000).optional(),
})

export function opportunityRouter(store: EntityStore): Router {
  const router = Router()

  // 创建机会：5 维评分 → 算总分 + 分档
  router.post('/', async (req, res, next) => {
    try {
      const parsed = createOpportunitySchema.parse(req.body)
      const total = scoreTotal(parsed.scores as Partial<Scores>)
      const opportunity = await store.create({
        type: 'opportunity',
        body: parsed.note,
        title: parsed.title,
        scope: parsed.scope,
        track: parsed.track,
        scores: parsed.scores,
        total,
        status: statusFor(total),
        source_idea_id: parsed.source_idea_id,
      })
      res.status(201).json(opportunity)
    } catch (err) {
      next(err)
    }
  })

  // 列出机会：?scope= ?status=
  router.get('/', async (req, res, next) => {
    try {
      const opportunities = (await store.list('opportunity')) as Opportunity[]
      const scope = req.query.scope
      const status = req.query.status
      let filtered = opportunities
      if (scope === 'personal' || scope === 'family') {
        filtered = filtered.filter((o) => o.scope === scope)
      }
      if (typeof status === 'string') {
        filtered = filtered.filter((o) => o.status === status)
      }
      res.json(filtered)
    } catch (err) {
      next(err)
    }
  })

  // 更新评分/标题/备注 → 重算总分 + 分档
  router.patch('/:id', async (req, res, next) => {
    try {
      const parsed = patchOpportunitySchema.parse(req.body)
      const existing = await store.get<Opportunity>('opportunity', req.params.id)
      if (!existing) {
        res.status(404).json({ error: 'NOT_FOUND' })
        return
      }
      const scores = { ...existing.scores, ...(parsed.scores ?? {}) } as Scores
      const total = scoreTotal(scores)
      const patch: Record<string, unknown> = {
        ...parsed,
        scores,
        total,
        status: statusFor(total),
      }
      delete patch.note
      const updated = await store.update<Opportunity>(
        'opportunity',
        req.params.id,
        patch,
        parsed.note !== undefined ? parsed.note : undefined,
      )
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  return router
}
