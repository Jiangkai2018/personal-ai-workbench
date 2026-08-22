import { Router } from 'express'
import { z } from 'zod'
import type { EntityStore } from '../../storage/repo'
import type { Task } from '../../domain/types'

/** 本地日期 YYYY-MM-DD */
export function localDateStr(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const taskStatus = z.enum(['todo', 'done', 'cancelled'])

const createTaskSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(200),
  goal_id: z.string().nullable().optional(),
  track: z.enum(['growth', 'maintenance']).optional(),
  scheduled_for: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '排期格式应为 YYYY-MM-DD').optional(),
  description: z.string().max(5000).default(''),
})

const patchTaskSchema = z.object({
  status: taskStatus.optional(),
  scheduled_for: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, '排期格式应为 YYYY-MM-DD')
    .nullable()
    .optional(),
  title: z.string().trim().min(1).optional(),
  goal_id: z.string().nullable().optional(),
})

/** 任务分区：today 今天 / week 未来 7 天 / future 7 天以外或无排期 / done 归档 */
const BUCKETS = new Set(['today', 'week', 'future', 'done'])

function filterByBucket(task: Task, bucket: string, today: string): boolean {
  const s = task.scheduled_for
  switch (bucket) {
    case 'today':
      return s === today && task.status === 'todo'
    case 'week': {
      if (!s || task.status !== 'todo') return false
      const diff = Math.round((new Date(s).getTime() - new Date(today).getTime()) / 86400000)
      return diff > 0 && diff <= 7
    }
    case 'future':
      // 无排期或 7 天以外（与 week 互斥，避免本周任务重复出现在未来分区）
      if (task.status !== 'todo' || !s) return task.status === 'todo' && !s
      {
        const diff = Math.round((new Date(s).getTime() - new Date(today).getTime()) / 86400000)
        return diff > 7
      }
    case 'done':
      return task.status === 'done' || task.status === 'cancelled'
    default:
      return true
  }
}

export function taskRouter(store: EntityStore): Router {
  const router = Router()

  // 创建任务：必须挂目标（growth）；维护轨道允许直达（goal_id 空）
  router.post('/', async (req, res, next) => {
    try {
      const parsed = createTaskSchema.parse(req.body)

      let scope: 'personal' | 'family'
      let track: 'growth' | 'maintenance'
      let goalId: string | null

      if (parsed.goal_id) {
        const goal = await store.get('goal', parsed.goal_id)
        if (!goal) {
          res.status(400).json({ error: 'INVALID_INPUT', issues: [{ path: 'goal_id', message: '目标不存在' }] })
          return
        }
        goalId = goal.id
        scope = goal.scope as 'personal' | 'family'
        track = goal.track as 'growth' | 'maintenance'
      } else {
        goalId = null
        track = parsed.track ?? 'maintenance'
        if (track !== 'maintenance') {
          res.status(400).json({
            error: 'INVALID_INPUT',
            issues: [{ path: 'goal_id', message: '成长轨道任务必须挂在目标下' }],
          })
          return
        }
        scope = req.body.scope === 'family' ? 'family' : 'personal'
      }

      const task = await store.create({
        type: 'task',
        body: parsed.description,
        title: parsed.title,
        goal_id: goalId,
        scope,
        track,
        status: 'todo',
        scheduled_for: parsed.scheduled_for,
      })
      res.status(201).json(task)
    } catch (err) {
      next(err)
    }
  })

  // 列出任务：?scope= ?status= ?bucket= ?goal_id=
  router.get('/', async (req, res, next) => {
    try {
      const tasks = (await store.list('task')) as Task[]
      const scope = req.query.scope
      const status = req.query.status
      const bucket = req.query.bucket
      const goalId = req.query.goal_id

      let filtered = tasks
      if (scope === 'personal' || scope === 'family') filtered = filtered.filter((t) => t.scope === scope)
      if (typeof status === 'string') filtered = filtered.filter((t) => t.status === status)
      if (typeof goalId === 'string') filtered = filtered.filter((t) => t.goal_id === goalId)
      if (typeof bucket === 'string' && BUCKETS.has(bucket)) {
        const today = localDateStr()
        filtered = filtered.filter((t) => filterByBucket(t, bucket, today))
      }
      res.json(filtered)
    } catch (err) {
      next(err)
    }
  })

  // 更新任务：勾选完成 / 改排期 / 改标题
  router.patch('/:id', async (req, res, next) => {
    try {
      const parsed = patchTaskSchema.parse(req.body)
      const patch: Record<string, unknown> = { ...parsed }
      if (parsed.status === 'done' && !patch.done_at) patch.done_at = new Date().toISOString()
      if (parsed.status && parsed.status !== 'done') patch.done_at = null
      if (parsed.scheduled_for === null) {
        patch.scheduled_for = undefined
      }
      const updated = await store.update<Task>('task', req.params.id, patch)
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
