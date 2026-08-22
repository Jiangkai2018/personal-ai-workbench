import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

describe('今日视图 API —— 首页 = 今日，形成 目标→任务→今日→勾选 闭环', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  let agent: ReturnType<typeof request.agent>
  let goalId: string
  let todayTaskId: string

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-'))
    await seedUsers(dataDir)
    app = createApp({ dataDir })
    agent = await loginAgent(app)

    const goal = await agent
      .post('/api/goals')
      .send({ title: 'AI 成长系统', scope: 'family', track: 'growth', status: 'active' })
      .expect(201)
    goalId = goal.body.id

    const t = await agent
      .post('/api/tasks')
      .send({ title: '今天要做的', goal_id: goalId, scheduled_for: todayStr() })
      .expect(201)
    todayTaskId = t.body.id

    await agent
      .post('/api/tasks')
      .send({ title: '明天的任务', goal_id: goalId, scheduled_for: tomorrowStr() })
      .expect(201)
  })
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  function tomorrowStr(): string {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }

  it('GET /api/today?scope= 返回今天任务 + 活跃目标，不含明天任务', async () => {
    const res = await agent.get('/api/today?scope=family').expect(200)
    expect(res.body.date).toBe(todayStr())
    expect(res.body.scope).toBe('family')
    expect(res.body.activeGoals.some((g: { title: string }) => g.title === 'AI 成长系统')).toBe(true)
    expect(res.body.items.some((t: { title: string }) => t.title === '今天要做的')).toBe(true)
    expect(res.body.items.some((t: { title: string }) => t.title === '明天的任务')).toBe(false)
  })

  it('勾选完成：PATCH 任务后，今日视图把它移到 done，items 里消失', async () => {
    await agent.patch(`/api/tasks/${todayTaskId}`).send({ status: 'done' }).expect(200)

    const res = await agent.get('/api/today?scope=family').expect(200)
    expect(res.body.items.some((t: { id: string }) => t.id === todayTaskId)).toBe(false)
    expect(res.body.done.some((t: { id: string }) => t.id === todayTaskId)).toBe(true)
  })
})
