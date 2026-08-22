// 领域分析报告：查询 + 悬挂任务兜底（服务重启后 running 状态无人推进）
import { Router } from 'express'
import type { EntityStore } from '../../storage/repo'
import type { Report } from '../../domain/types'

/** running 超过该分钟数视为悬挂（服务重启导致），读取时自动落为 failed */
const STALE_MINUTES = 10

export function reportRouter(store: EntityStore): Router {
  const router = Router()

  async function failStale(report: Report): Promise<Report> {
    const age = Date.now() - new Date(report.started_at).getTime()
    if (report.status === 'running' && age > STALE_MINUTES * 60_000) {
      return (await store.update<Report>(
        'report',
        report.id,
        {
          status: 'failed',
          error: `分析超过 ${STALE_MINUTES} 分钟未完成（可能因服务重启中断），请重新分析`,
          finished_at: new Date().toISOString(),
        },
      ))!
    }
    return report
  }

  // 报告列表：?opportunity_id= 过滤，新的在前
  router.get('/', async (req, res, next) => {
    try {
      const reports = (await store.list('report')) as Report[]
      const fixed = await Promise.all(reports.map(failStale))
      const oppId = req.query.opportunity_id
      res.json(typeof oppId === 'string' ? fixed.filter((r) => r.opportunity_id === oppId) : fixed)
    } catch (err) {
      next(err)
    }
  })

  // 单份报告（查看页用）
  router.get('/:id', async (req, res, next) => {
    try {
      const report = await store.get<Report>('report', req.params.id)
      if (!report) {
        res.status(404).json({ error: 'NOT_FOUND', message: '报告不存在' })
        return
      }
      res.json(await failStale(report))
    } catch (err) {
      next(err)
    }
  })

  return router
}
