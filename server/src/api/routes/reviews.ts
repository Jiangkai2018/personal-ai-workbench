// 晚间复盘：勾选今日完成项后，生成日小结 + 更新目标进度（设计方案第三/四节）
// V0 用确定性规则生成（完成项统计 + 目标进度递增），后续可换成复盘 Agent
import { Router } from 'express'
import { z } from 'zod'
import type { EntityStore } from '../../storage/repo'
import { ReviewStore, type GoalUpdate, type Review } from '../../storage/reviewStore'
import type { Goal, Task } from '../../domain/types'
import { localDateStr } from './tasks'

/** 每个完成的挂目标任务 → 目标进度 +10%（封顶 100），V0 简化规则 */
const PROGRESS_PER_TASK = 10

export function reviewRouter(store: EntityStore, reviewStore: ReviewStore): Router {
  const router = Router()

  // 生成今天（或指定日期）的复盘；同一天同一范围已存在 → 幂等返回，不重复计数
  router.post('/', async (req, res, next) => {
    try {
      const parsed = z.object({ scope: z.enum(['personal', 'family']).default('personal'), date: z.string().optional() }).parse(req.body)
      const scope = parsed.scope
      const date = parsed.date ?? localDateStr()

      const existing = await reviewStore.get(ReviewStore.idFor(date, scope))
      if (existing) {
        res.status(200).json(existing)
        return
      }

      // 当天该范围已勾选的完成项
      const allTasks = (await store.list('task')) as Task[]
      const doneToday = allTasks.filter(
        (t) => t.scope === scope && t.scheduled_for === date && t.status === 'done',
      )

      // 按目标归组 → 更新目标进度
      const goals = (await store.list('goal')) as Goal[]
      const goalMap = new Map(goals.map((g) => [g.id, g]))
      const goalUpdates: GoalUpdate[] = []
      const doneByGoal = new Map<string, Task[]>()
      for (const t of doneToday) {
        if (t.goal_id) {
          const arr = doneByGoal.get(t.goal_id) ?? []
          arr.push(t)
          doneByGoal.set(t.goal_id, arr)
        }
      }
      for (const [goalId, tasks] of doneByGoal) {
        const goal = goalMap.get(goalId)
        if (!goal) continue
        const from = goal.progress
        const to = Math.min(100, from + tasks.length * PROGRESS_PER_TASK)
        await store.update('goal', goalId, { progress: to })
        goalUpdates.push({ goal_id: goalId, title: goal.title, from, to })
      }

      const completed = doneToday.length
      const summary = completed > 0 ? `完成 ${completed} 件事` : `今天没有完成项`
      const bodyLines = [
        `${summary}：`,
        ...(doneToday.length > 0 ? doneToday.map((t) => `- ${t.title}`) : ['- （无）']),
      ]
      if (goalUpdates.length > 0) {
        bodyLines.push('', '目标进度更新：')
        for (const u of goalUpdates) {
          bodyLines.push(`- ${u.title}：${u.from}% → ${u.to}%`)
        }
      }

      const review: Review = {
        id: ReviewStore.idFor(date, scope),
        date,
        scope,
        completed,
        goal_updates: goalUpdates,
        summary,
        content: bodyLines.join('\n'),
        created_at: new Date().toISOString(),
      }
      await reviewStore.save(review)
      res.status(201).json(review)
    } catch (err) {
      next(err)
    }
  })

  // 复盘时间线
  router.get('/', async (_req, res, next) => {
    try {
      res.json(await reviewStore.list())
    } catch (err) {
      next(err)
    }
  })

  return router
}
