import { Router } from 'express'
import type { EntityStore } from '../../storage/repo'
import type { Goal, Task } from '../../domain/types'
import { localDateStr } from './tasks'

export function todayRouter(store: EntityStore): Router {
  const router = Router()

  // 首页 = 今日：今天的任务（待办/已完成）+ 活跃目标（供快速添加下拉）
  router.get('/', async (req, res, next) => {
    try {
      const scope = req.query.scope === 'family' ? 'family' : 'personal'
      const today = localDateStr()

      const tasks = (await store.list('task')).filter(
        (t) => t.scope === scope && (t as Task).scheduled_for === today,
      ) as Task[]
      const goals = (await store.list('goal')).filter(
        (g) => g.scope === scope && g.status === 'active',
      ) as Goal[]

      const items = tasks.filter((t) => t.status === 'todo')
      const done = tasks.filter((t) => t.status === 'done')

      res.json({ date: today, scope, items, done, activeGoals: goals })
    } catch (err) {
      next(err)
    }
  })

  return router
}
