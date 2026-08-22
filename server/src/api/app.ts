import express from 'express'
import cookieParser from 'cookie-parser'
import type { Express } from 'express'
import { ZodError } from 'zod'
import { EntityStore } from '../storage/repo'
import { ReviewStore } from '../storage/reviewStore'
import { authRouter } from './routes/auth'
import { requireAuth } from './middleware'
import { ideaRouter } from './routes/ideas'
import { goalRouter } from './routes/goals'
import { taskRouter } from './routes/tasks'
import { todayRouter } from './routes/today'
import { opportunityRouter } from './routes/opportunities'
import { proposalRouter } from './routes/proposals'
import { reviewRouter } from './routes/reviews'

export interface AppOptions {
  dataDir: string
  jwtSecret?: string
}

const DEFAULT_JWT_SECRET = 'dev-secret-change-me'

export function createApp({ dataDir, jwtSecret }: AppOptions): Express {
  const secret = jwtSecret ?? process.env.WORKBENCH_JWT_SECRET ?? DEFAULT_JWT_SECRET
  if (secret === DEFAULT_JWT_SECRET && process.env.NODE_ENV !== 'test') {
    // 开源默认值兜底：带默认密钥对外部署是真实风险，启动时大声提醒
    console.warn(
      '[workbench] ⚠ 正在使用默认 JWT 密钥。请设置 WORKBENCH_JWT_SECRET 环境变量后再对外暴露服务。',
    )
  }
  const store = new EntityStore(dataDir)
  const reviewStore = new ReviewStore(dataDir)
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  // 健康检查：部署探活 / 监控 / CI 冒烟（公开，不触盘）
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) })
  })

  // 登录/找回等公开路由；其余 /api/* 全部 requireAuth（工作台默认登录后可进）
  app.use('/api/auth', authRouter(dataDir, secret))
  app.use('/api/ideas', requireAuth(secret), ideaRouter(store))
  app.use('/api/opportunities', requireAuth(secret), opportunityRouter(store))
  app.use('/api/proposals', requireAuth(secret), proposalRouter(store))
  app.use('/api/goals', requireAuth(secret), goalRouter(store))
  app.use('/api/tasks', requireAuth(secret), taskRouter(store))
  app.use('/api/today', requireAuth(secret), todayRouter(store))
  app.use('/api/reviews', requireAuth(secret), reviewRouter(store, reviewStore))

  // 统一错误处理：zod 校验失败 → 400，其余 → 500
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'INVALID_INPUT',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'INTERNAL_ERROR' })
  })

  return app
}
