// AI 初评：注入假 AiScorer，覆盖预览/落盘/转正联动（真实接口不在单测里调）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'
import { AiError, type AiScorer } from '../src/ai/scoreClient'
import type { Scores } from '../src/domain/opportunity'

const FAKE: Scores = { value: 16, feasible: 12, window: 14, fit: 15, risk: 13 } // 总分 70 → observing

function fakeScorer(thrower?: () => never): AiScorer {
  return {
    async score() {
      if (thrower) thrower()
      return { ...FAKE }
    },
  }
}

function aiUnavailable(): never {
  throw new AiError('AI 未配置：请在 .env 或环境变量中设置 WORKBENCH_AI_API_KEY')
}

describe('AI 初评 —— 机会 5 维打分', () => {
  let dataDir: string
  let agent: ReturnType<typeof request.agent>

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-'))
    await seedUsers(dataDir)
    const app = createApp({ dataDir, aiScorer: fakeScorer() })
    agent = await loginAgent(app)
  })

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('AI 预评不落盘：POST /ai-preview 只返回分数', async () => {
    const res = await agent
      .post('/api/opportunities/ai-preview')
      .send({ title: '海外独立开发' })
      .expect(200)
    expect(res.body.scores).toEqual(FAKE)
    // 没有创建任何文件
    const files = await readdir(path.join(dataDir, 'opportunities')).catch(() => [])
    expect(files).toHaveLength(0)
  })

  it('AI 初评落盘：POST /:id/ai-score 更新分数/总分/分档并标记 ai_scored', async () => {
    const created = await agent
      .post('/api/opportunities')
      .send({ title: '卖课副业', scope: 'personal' })
      .expect(201)
    expect(created.body.total).toBe(0)

    const res = await agent.post(`/api/opportunities/${created.body.id}/ai-score`).expect(200)
    expect(res.body.scores).toEqual(FAKE)
    expect(res.body.total).toBe(70)
    expect(res.body.status).toBe('observing')
    expect(res.body.ai_scored).toBe(true)

    const raw = await readFile(path.join(dataDir, 'opportunities', `${created.body.id}.md`), 'utf8')
    expect(raw).toContain('ai_scored: true')
    expect(raw).toContain('total: 70')
  })

  it('想法一键转正：自动带 AI 初评分数 + 回填 promoted_to_id', async () => {
    const idea = await agent.post('/api/ideas').send({ content: '想做一个 RSS 聚合器' }).expect(201)
    const opp = await agent.post(`/api/ideas/${idea.body.id}/promote`).expect(201)
    expect(opp.body.scores).toEqual(FAKE)
    expect(opp.body.total).toBe(70)
    expect(opp.body.ai_scored).toBe(true)
    expect(opp.body.source_idea_id).toBe(idea.body.id)

    const updatedIdea = await agent.get('/api/ideas').expect(200)
    expect(updatedIdea.body.find((i: { id: string }) => i.id === idea.body.id).promoted_to_id).toBe(
      opp.body.id,
    )
  })

  it('AI 不可用不阻塞转正：0 分创建机会', async () => {
    const app = createApp({ dataDir, aiScorer: fakeScorer(aiUnavailable) })
    const a = await loginAgent(app)
    const idea = await a.post('/api/ideas').send({ content: 'AI 挂了也要转正' }).expect(201)
    const opp = await a.post(`/api/ideas/${idea.body.id}/promote`).expect(201)
    expect(opp.body.total).toBe(0)
    expect(opp.body.ai_scored).toBeUndefined()
  })

  it('未配置 AI 时预评返回 503 + 可读信息', async () => {
    const app = createApp({ dataDir, aiScorer: fakeScorer(aiUnavailable) })
    const a = await loginAgent(app)
    const res = await a.post('/api/opportunities/ai-preview').send({ title: 'x' }).expect(503)
    expect(res.body.error).toBe('AI_UNAVAILABLE')
    expect(res.body.message).toContain('WORKBENCH_AI_API_KEY')
  })
})
