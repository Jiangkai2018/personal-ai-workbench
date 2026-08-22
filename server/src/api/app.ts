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
import { reviewRouter } from './routes/reviews'
import { reportRouter } from './routes/reports'
import { financeRouter } from './routes/finance'
import { AiError, createAiScorer, type AiScorer } from '../ai/scoreClient'
import { createReportGenerator, type ReportGenerator } from '../ai/reportClient'

export interface AppOptions {
  dataDir: string
  jwtSecret?: string
  /** 可注入假实现供测试；默认读环境变量创建真实客户端 */
  aiScorer?: AiScorer
  reportGenerator?: ReportGenerator
}

const DEFAULT_JWT_SECRET = 'dev-secret-change-me'

export function createApp({ dataDir, jwtSecret, aiScorer, reportGenerator }: AppOptions): Express {
  const secret = jwtSecret ?? process.env.WORKBENCH_JWT_SECRET ?? DEFAULT_JWT_SECRET
  if (secret === DEFAULT_JWT_SECRET && process.env.NODE_ENV !== 'test') {
    // 开源默认值兜底：带默认密钥对外部署是真实风险，启动时大声提醒
    console.warn(
      '[workbench] ⚠ 正在使用默认 JWT 密钥。请设置 WORKBENCH_JWT_SECRET 环境变量后再对外暴露服务。',
    )
  }
  const store = new EntityStore(dataDir)
  const reviewStore = new ReviewStore(dataDir)
  const scorer = aiScorer ?? createAiScorer()
  const generator = reportGenerator ?? createReportGenerator()
  const app = express()
  app.use(express.json())
  app.use(cookieParser())

  // 健康检查：部署探活 / 监控 / CI 冒烟（公开，不触盘）
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) })
  })

  // 登录/找回等公开路由；其余 /api/* 全部 requireAuth（工作台默认登录后可进）
  app.use('/api/auth', authRouter(dataDir, secret))
  app.use('/api/ideas', requireAuth(secret), ideaRouter(store, scorer))
  app.use('/api/opportunities', requireAuth(secret), opportunityRouter(store, scorer, generator))
  app.use('/api/reports', requireAuth(secret), reportRouter(store))
  app.use('/api/goals', requireAuth(secret), goalRouter(store))
  app.use('/api/tasks', requireAuth(secret), taskRouter(store))
  app.use('/api/today', requireAuth(secret), todayRouter(store))
  app.use('/api/reviews', requireAuth(secret), reviewRouter(store, reviewStore))
  app.use('/api/finance', requireAuth(secret), financeRouter(dataDir))

  // 统一错误处理：zod 校验失败 → 400，AI 不可用 → 503，其余 → 500
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: 'INVALID_INPUT',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
      return
    }
    if (err instanceof AiError) {
      res.status(503).json({ error: 'AI_UNAVAILABLE', message: err.message })
      return
    }
    console.error(err)
    res.status(500).json({ error: 'INTERNAL_ERROR' })
  })

  return app
}
