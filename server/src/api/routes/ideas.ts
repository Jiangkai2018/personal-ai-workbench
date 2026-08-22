import { Router } from 'express'
import { z } from 'zod'
import type { EntityStore } from '../../storage/repo'

const createIdeaSchema = z.object({
  content: z.string().trim().min(1, '内容不能为空').max(2000),
  scope: z.enum(['personal', 'family']).default('personal'),
  track: z.enum(['growth', 'maintenance']).default('growth'),
})

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

  return router
}
