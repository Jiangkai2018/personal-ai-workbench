// 转正提案 + 确认中心：承诺类动作（想法→机会、机会→目标）必须先落提案，
// 用户在 Web 确认中心批准后，这里才执行文件操作（设计：Agent 只提案、用户确认）。
import { Router } from 'express'
import { z } from 'zod'
import type { EntityStore } from '../../storage/repo'
import type { Proposal, Opportunity } from '../../domain/types'
import { statusFor } from '../../domain/opportunity'

const createProposalSchema = z.object({
  action: z.enum(['promote_idea_to_opportunity', 'promote_opportunity_to_goal']),
  source_id: z.string().min(1),
  /** 可选：转正后的标题；默认取源实体的标题/内容 */
  title: z.string().trim().min(1).max(200).optional(),
  /** 机会→目标时可带目标参数 */
  description: z.string().max(5000).optional(),
  milestones: z.array(z.string()).max(20).optional(),
})

export function proposalRouter(store: EntityStore): Router {
  const router = Router()

  /** 同一源实体已存在未处理的转正提案 → 不重复提案 */
  async function hasPending(sourceId: string): Promise<boolean> {
    const pending = (await store.list('proposal')) as Proposal[]
    return pending.some((p) => p.source_id === sourceId && p.status === 'pending')
  }

  // 从想法/机会发起转正提案（Agent 只提案，不生效）
  router.post('/', async (req, res, next) => {
    try {
      const parsed = createProposalSchema.parse(req.body)
      const { action, source_id } = parsed

      if (await hasPending(source_id)) {
        res.status(409).json({ error: 'DUPLICATE_PROPOSAL', message: '该实体已有待确认的转正提案' })
        return
      }

      if (action === 'promote_idea_to_opportunity') {
        const idea = await store.get('idea', source_id)
        if (!idea) {
          res.status(400).json({ error: 'INVALID_INPUT', issues: [{ path: 'source_id', message: '想法不存在' }] })
          return
        }
        const title = parsed.title ?? idea.content.slice(0, 200)
        const proposal = await store.create({
          type: 'proposal',
          status: 'pending',
          action,
          summary: `把想法「${idea.content}」转正为机会`,
          source_type: 'idea',
          source_id: idea.id,
          payload: { title, scope: idea.scope, track: idea.track, idea_content: idea.content },
        })
        res.status(201).json(proposal)
        return
      }

      // promote_opportunity_to_goal
      const opp = await store.get<Opportunity>('opportunity', source_id)
      if (!opp) {
        res.status(400).json({ error: 'INVALID_INPUT', issues: [{ path: 'source_id', message: '机会不存在' }] })
        return
      }
      if (opp.goal_id) {
        res.status(409).json({ error: 'ALREADY_PROMOTED', message: '该机会已转正为目标' })
        return
      }
      const proposal = await store.create({
        type: 'proposal',
        status: 'pending',
        action,
        summary: `把机会「${opp.title}」转正为目标`,
        source_type: 'opportunity',
        source_id: opp.id,
        payload: {
          title: parsed.title ?? opp.title,
          scope: opp.scope,
          track: opp.track,
          description: parsed.description ?? '',
          milestones: parsed.milestones ?? [],
        },
      })
      res.status(201).json(proposal)
    } catch (err) {
      next(err)
    }
  })

  // 确认中心列表：?status=pending 等
  router.get('/', async (req, res, next) => {
    try {
      const proposals = (await store.list('proposal')) as Proposal[]
      const status = req.query.status
      res.json(typeof status === 'string' ? proposals.filter((p) => p.status === status) : proposals)
    } catch (err) {
      next(err)
    }
  })

  // 批准：执行文件操作（创建机会/目标）+ 提案标记 approved（设计：批准后由 Web 层执行）
  router.post('/:id/approve', async (req, res, next) => {
    try {
      const proposal = await store.get<Proposal>('proposal', req.params.id)
      if (!proposal) {
        res.status(404).json({ error: 'NOT_FOUND' })
        return
      }
      if (proposal.status !== 'pending') {
        res.status(409).json({ error: 'ALREADY_DECIDED', message: '该提案已处理' })
        return
      }

      if (proposal.action === 'promote_idea_to_opportunity') {
        const idea = await store.get('idea', proposal.source_id)
        if (!idea) {
          res.status(404).json({ error: 'SOURCE_LOST', message: '源想法已不存在' })
          return
        }
        const created = await store.create({
          type: 'opportunity',
          body: (proposal.payload.idea_content as string) ?? '',
          title: proposal.payload.title as string,
          scope: proposal.payload.scope as 'personal' | 'family',
          track: proposal.payload.track as 'growth' | 'maintenance',
          scores: { value: 0, feasible: 0, window: 0, fit: 0, risk: 0 },
          total: 0,
          status: statusFor(0),
          source_idea_id: idea.id,
        })
        await store.update('idea', idea.id, { promoted_to_id: created.id })
      } else {
        // promote_opportunity_to_goal
        const opp = await store.get<Opportunity>('opportunity', proposal.source_id)
        if (!opp) {
          res.status(404).json({ error: 'SOURCE_LOST', message: '源机会已不存在' })
          return
        }
        const created = await store.create({
          type: 'goal',
          body: (proposal.payload.description as string) ?? '',
          title: proposal.payload.title as string,
          scope: proposal.payload.scope as 'personal' | 'family',
          track: proposal.payload.track as 'growth' | 'maintenance',
          milestones: (proposal.payload.milestones as string[]) ?? [],
          progress: 0,
          status: 'active',
        })
        await store.update('opportunity', opp.id, { goal_id: created.id })
      }

      const updated = await store.update<Proposal>('proposal', proposal.id, {
        status: 'approved',
        decided_at: new Date().toISOString(),
        decided_by: req.user?.name ?? 'unknown',
      })
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  // 驳回：标记 rejected，不执行任何文件操作
  router.post('/:id/reject', async (req, res, next) => {
    try {
      const proposal = await store.get<Proposal>('proposal', req.params.id)
      if (!proposal) {
        res.status(404).json({ error: 'NOT_FOUND' })
        return
      }
      if (proposal.status !== 'pending') {
        res.status(409).json({ error: 'ALREADY_DECIDED', message: '该提案已处理' })
        return
      }
      const updated = await store.update<Proposal>('proposal', proposal.id, {
        status: 'rejected',
        decided_at: new Date().toISOString(),
        decided_by: req.user?.name ?? 'unknown',
      })
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  return router
}
