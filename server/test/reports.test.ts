// 领域分析（异步长任务）：假生成器覆盖 启动/成功写回/失败写回/并发 409/悬挂兜底
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'
import type { ReportGenerator } from '../src/ai/reportClient'
import type { Report } from '../src/domain/types'

/** 等后台任务把报告写成目标状态（假生成器毫秒级完成，轮询兜底） */
async function waitStatus(agent: ReturnType<typeof request.agent>, id: string, status: string) {
  for (let i = 0; i < 50; i++) {
    const res = await agent.get(`/api/reports/${id}`).expect(200)
    if (res.body.status === status) return res.body as Report
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`报告未进入 ${status} 状态`)
}

function gen(impl: () => Promise<string>): ReportGenerator {
  return { model: 'fake-model', generate: impl }
}

describe('领域分析 —— 异步报告任务', () => {
  let dataDir: string
  let agent: ReturnType<typeof request.agent>
  let oppId: string

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-'))
    await seedUsers(dataDir)
    const app = createApp({
      dataDir,
      reportGenerator: gen(async () => '## 一、赛道与市场\n\n测试报告内容。'),
    })
    agent = await loginAgent(app)
    const opp = await agent.post('/api/opportunities').send({ title: '母婴类的自媒体' }).expect(201)
    oppId = opp.body.id
  })

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('发起分析：202 返回 running 报告，完成后内容写进 .md 文件', async () => {
    const started = await agent.post(`/api/opportunities/${oppId}/analyze`).expect(202)
    expect(started.body.status).toBe('running')
    expect(started.body.opportunity_title).toBe('母婴类的自媒体')
    expect(started.body.model).toBe('fake-model')

    const done = await waitStatus(agent, started.body.id, 'done')
    expect(done.content).toContain('## 一、赛道与市场')

    const raw = await readFile(path.join(dataDir, 'reports', `${started.body.id}.md`), 'utf8')
    expect(raw).toContain('status: done')
    expect(raw).toContain('测试报告内容')
  })

  it('同一机会分析进行中再发起 → 409', async () => {
    const slowApp = createApp({
      dataDir,
      reportGenerator: gen(async () => {
        await new Promise((r) => setTimeout(r, 500))
        return '## 慢报告'
      }),
    })
    const slowAgent = await loginAgent(slowApp)
    const opp = await slowAgent.post('/api/opportunities').send({ title: '慢分析机会' }).expect(201)
    await slowAgent.post(`/api/opportunities/${opp.body.id}/analyze`).expect(202)
    const dup = await slowAgent.post(`/api/opportunities/${opp.body.id}/analyze`).expect(409)
    expect(dup.body.error).toBe('ANALYZE_RUNNING')
    await waitStatus(slowAgent, (await slowAgent.get('/api/reports').expect(200)).body[0].id, 'done')
  })

  it('生成失败：报告落为 failed 并带可读错误', async () => {
    const failApp = createApp({
      dataDir,
      reportGenerator: gen(async () => {
        throw new Error('AI 未配置：请在 .env 或环境变量中设置 WORKBENCH_AI_API_KEY')
      }),
    })
    const failAgent = await loginAgent(failApp)
    const opp = await failAgent.post('/api/opportunities').send({ title: '失败机会' }).expect(201)
    const started = await failAgent.post(`/api/opportunities/${opp.body.id}/analyze`).expect(202)
    const failed = await waitStatus(failAgent, started.body.id, 'failed')
    expect(failed.error).toContain('WORKBENCH_AI_API_KEY')
  })

  it('悬挂兜底：running 超过 10 分钟，读取时自动落为 failed', async () => {
    const app = createApp({ dataDir, reportGenerator: gen(async () => '永不到达') })
    const a = await loginAgent(app)
    const opp = await a.post('/api/opportunities').send({ title: '悬挂机会' }).expect(201)
    // 手工把 started_at 改到 11 分钟前，模拟服务重启后的孤儿任务
    const started = await a.post(`/api/opportunities/${opp.body.id}/analyze`).expect(202)
    await waitStatus(a, started.body.id, 'done')
    const file = path.join(dataDir, 'reports', `${started.body.id}.md`)
    const raw = await readFile(file, 'utf8')
    const elevenMinAgo = new Date(Date.now() - 11 * 60_000).toISOString()
    await writeFile(
      file,
      raw
        .replace('status: done', 'status: running')
        .replace(/started_at: .*/, `started_at: '${elevenMinAgo}'`),
      'utf8',
    )
    const res = await a.get(`/api/reports/${started.body.id}`).expect(200)
    expect(res.body.status).toBe('failed')
    expect(res.body.error).toContain('重新分析')
  })

  it('按机会过滤：GET /api/reports?opportunity_id= 只返回该机会的报告', async () => {
    const res = await agent.get(`/api/reports?opportunity_id=${oppId}`).expect(200)
    expect(res.body.length).toBeGreaterThan(0)
    expect(res.body.every((r: Report) => r.opportunity_id === oppId)).toBe(true)
  })
})
