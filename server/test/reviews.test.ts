import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

describe('晚间复盘 —— 勾选今日完成 → 日小结 + 更新目标进度', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  let agent: ReturnType<typeof request.agent>
  let goalId: string

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-review-'))
    await seedUsers(dataDir)
    app = createApp({ dataDir })
    agent = await loginAgent(app)

    const goal = await agent
      .post('/api/goals')
      .send({ title: 'AI 成长系统', scope: 'personal', track: 'growth' })
      .expect(201)
    goalId = goal.body.id
  })
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('复盘生成：POST /api/reviews 产出日小结并落盘 .md', async () => {
    // 完成 2 件挂该目标的任务
    for (const title of ['写周报', '读一章书']) {
      const t = await agent
        .post('/api/tasks')
        .send({ title, goal_id: goalId, scheduled_for: todayStr() })
        .expect(201)
      await agent.patch(`/api/tasks/${t.body.id}`).send({ status: 'done' }).expect(200)
    }

    const res = await agent.post('/api/reviews').send({ scope: 'personal' }).expect(201)
    expect(res.body).toMatchObject({
      scope: 'personal',
      date: todayStr(),
      completed: 2,
      summary: '完成 2 件事',
    })
    expect(res.body.content).toContain('写周报')
    expect(res.body.content).toContain('读一章书')

    // 复盘文件落盘
    const files = await readdir(path.join(dataDir, 'reviews'))
    expect(files.length).toBe(1)
    const raw = await readFile(path.join(dataDir, 'reviews', files[0]), 'utf8')
    expect(raw).toContain('summary: 完成 2 件事')
  })

  it('复盘更新目标进度：每个完成项 +10，2 件 → +20%', async () => {
    // 上面复盘的 goal_updates 里应有进度更新
    const reviews = await agent.get('/api/reviews').expect(200)
    const review = reviews.body.find((r: { id: string }) => r.id.includes(todayStr()))
    expect(review.goal_updates).toHaveLength(1)
    expect(review.goal_updates[0]).toMatchObject({
      title: 'AI 成长系统',
      from: 0,
      to: 20,
    })

    const goals = await agent.get('/api/goals').expect(200)
    const goal = goals.body.find((g: { id: string }) => g.id === goalId)
    expect(goal.progress).toBe(20)
  })

  it('幂等：同一天同一范围再次复盘 → 返回已有复盘，不重复计数不加进度', async () => {
    // 再完成一件
    const t = await agent
      .post('/api/tasks')
      .send({ title: '加件任务', goal_id: goalId, scheduled_for: todayStr() })
      .expect(201)
    await agent.patch(`/api/tasks/${t.body.id}`).send({ status: 'done' }).expect(200)

    // 已有复盘 → 返回 200 且仍是 2 件（不把"加件任务"算进去）
    const res = await agent.post('/api/reviews').send({ scope: 'personal' }).expect(200)
    expect(res.body.completed).toBe(2)
    expect(res.body.content).not.toContain('加件任务')

    // 目标进度仍是 20
    const goals = await agent.get('/api/goals').expect(200)
    expect(goals.body.find((g: { id: string }) => g.id === goalId).progress).toBe(20)
  })

  it('不同范围复盘独立：family 范围没有完成项时也能生成', async () => {
    const res = await agent.post('/api/reviews').send({ scope: 'family' }).expect(201)
    expect(res.body.completed).toBe(0)
    expect(res.body.summary).toContain('没有完成项')
    expect(res.body.id).toContain('family')
  })

  it('复盘时间线：GET /api/reviews 按日期倒序返回全部', async () => {
    const res = await agent.get('/api/reviews').expect(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThanOrEqual(2)
  })
})
