import { Router } from 'express'
import { z } from 'zod'
import type { EntityStore } from '../../storage/repo'
import type { Opportunity, Report } from '../../domain/types'
import { scoreTotal, statusFor, type Scores } from '../../domain/opportunity'
import type { AiScorer } from '../../ai/scoreClient'
import type { ReportGenerator } from '../../ai/reportClient'

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

export function opportunityRouter(
  store: EntityStore,
  aiScorer: AiScorer,
  reportGenerator: ReportGenerator,
): Router {
  const router = Router()

  // AI 预评（不落盘）：给"新机会"表单填初值，用户调整后再创建
  // 注意放在 /:id 之前注册，避免被参数路由吞掉
  const aiPreviewSchema = z.object({
    title: z.string().trim().min(1, '标题不能为空').max(200),
    note: z.string().max(2000).optional(),
  })
  router.post('/ai-preview', async (req, res, next) => {
    try {
      const parsed = aiPreviewSchema.parse(req.body)
      const scores = await aiScorer.score(parsed)
      res.json({ scores })
    } catch (err) {
      next(err)
    }
  })

  // AI 初评（落盘）：对已有机会打分并保存，标记 ai_scored；用户可继续用滑块调整
  router.post('/:id/ai-score', async (req, res, next) => {
    try {
      const existing = await store.get<Opportunity>('opportunity', req.params.id)
      if (!existing) {
        res.status(404).json({ error: 'NOT_FOUND', message: '机会不存在' })
        return
      }
      const scores = await aiScorer.score({ title: existing.title, note: existing.note })
      const total = scoreTotal(scores)
      const updated = await store.update<Opportunity>('opportunity', existing.id, {
        scores,
        total,
        status: statusFor(total),
        ai_scored: true,
        ai_scored_at: new Date().toISOString(),
      })
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  // 领域分析：异步长任务 —— 立即返回 running 状态的报告，后台生成完写回文件
  router.post('/:id/analyze', async (req, res, next) => {
    try {
      const opp = await store.get<Opportunity>('opportunity', req.params.id)
      if (!opp) {
        res.status(404).json({ error: 'NOT_FOUND', message: '机会不存在' })
        return
      }
      const reports = (await store.list('report')) as Report[]
      if (reports.some((r) => r.opportunity_id === opp.id && r.status === 'running')) {
        res.status(409).json({ error: 'ANALYZE_RUNNING', message: '该机会已有分析在进行中' })
        return
      }

      const report = await store.create({
        type: 'report',
        status: 'running',
        opportunity_id: opp.id,
        opportunity_title: opp.title,
        model: reportGenerator.model,
        scope: opp.scope,
        track: opp.track,
        body: '',
        started_at: new Date().toISOString(),
      })

      // 后台任务：失败不抛到路由，写回报告文件
      void (async () => {
        try {
          const content = await reportGenerator.generate({ title: opp.title, note: opp.note })
          await store.update('report', report.id, { status: 'done', finished_at: new Date().toISOString() }, content)
        } catch (err) {
          await store.update('report', report.id, {
            status: 'failed',
            error: (err as Error).message,
            finished_at: new Date().toISOString(),
          })
        }
      })()

      res.status(202).json(report)
    } catch (err) {
      next(err)
    }
  })

  // 一键转正为目标（直达，无确认环节）：创建目标 + 回填 goal_id
  router.post('/:id/promote-to-goal', async (req, res, next) => {
    try {
      const opp = await store.get<Opportunity>('opportunity', req.params.id)
      if (!opp) {
        res.status(404).json({ error: 'NOT_FOUND', message: '机会不存在' })
        return
      }
      if (opp.goal_id) {
        res.status(409).json({ error: 'ALREADY_PROMOTED', message: '该机会已转正为目标' })
        return
      }
      const goal = await store.create({
        type: 'goal',
        body: opp.note ?? '',
        title: opp.title,
        scope: opp.scope,
        track: opp.track,
        milestones: [],
        progress: 0,
        status: 'active',
      })
      await store.update('opportunity', opp.id, { goal_id: goal.id })
      res.status(201).json(goal)
    } catch (err) {
      next(err)
    }
  })

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
