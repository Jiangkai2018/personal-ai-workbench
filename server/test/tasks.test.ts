import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

/** 本地日期 YYYY-MM-DD */
function todayStr(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

describe('任务 API —— 每天做的事，必须指向目标', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  let agent: ReturnType<typeof request.agent>
  let goalId: string

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-'))
    await seedUsers(dataDir)
    app = createApp({ dataDir })
    agent = await loginAgent(app)
    const goal = await agent
      .post('/api/goals')
      .send({ title: 'AI 成长系统', scope: 'family', track: 'growth' })
      .expect(201)
    goalId = goal.body.id
  })
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('创建任务：挂目标并继承 scope/track', async () => {
    const res = await agent
      .post('/api/tasks')
      .send({ title: '写今天 3 件事', goal_id: goalId, scheduled_for: todayStr() })
      .expect(201)

    expect(res.body).toMatchObject({
      type: 'task',
      title: '写今天 3 件事',
      goal_id: goalId,
      scope: 'family', // 继承目标
      track: 'growth',
      status: 'todo',
      scheduled_for: todayStr(),
    })
  })

  it('挂不存在的目标返回 400', async () => {
    const res = await agent
      .post('/api/tasks')
      .send({ title: '无主任务', goal_id: 'nope' })
      .expect(400)
    expect(res.body.error).toBe('INVALID_INPUT')
  })

  it('不挂目标的任务：维护轨道直达，goal_id 为空', async () => {
    const res = await agent
      .post('/api/tasks')
      .send({ title: '给娃打疫苗', track: 'maintenance' })
      .expect(201)
    expect(res.body.goal_id).toBeNull()
    expect(res.body.track).toBe('maintenance')
  })

  it('勾选完成：PATCH status=done 记录 done_at，文件同步', async () => {
    const created = await agent
      .post('/api/tasks')
      .send({ title: '修车钥匙', goal_id: goalId, track: 'growth', scheduled_for: todayStr() })
      .expect(201)
    const id = created.body.id

    const res = await agent.patch(`/api/tasks/${id}`).send({ status: 'done' }).expect(200)
    expect(res.body.status).toBe('done')
    expect(res.body.done_at).toBeTruthy()

    const raw = await readFile(path.join(dataDir, 'tasks', `${id}.md`), 'utf8')
    expect(raw).toContain('status: done')
    expect(raw).toContain('done_at:')
  })

  it('按 bucket 过滤：today/week/future/done', async () => {
    // 已有一条今天任务（第一条）+ 一条明天 + 一条无排期
    await agent
      .post('/api/tasks')
      .send({ title: '明天的任务', goal_id: goalId, scheduled_for: todayStr(1) })
      .expect(201)
    await agent
      .post('/api/tasks')
      .send({ title: '无排期的未来任务', goal_id: goalId })
      .expect(201)

    const today = await agent.get('/api/tasks?bucket=today').expect(200)
    expect(today.body.every((t: { scheduled_for?: string }) => t.scheduled_for === todayStr())).toBe(true)

    const done = await agent.get('/api/tasks?bucket=done').expect(200)
    expect(done.body).toHaveLength(1) // 修车钥匙
    expect(done.body[0].status).toBe('done')

    const future = await agent.get('/api/tasks?bucket=future').expect(200)
    expect(future.body.some((t: { title: string }) => t.title === '无排期的未来任务')).toBe(true)
  })

  it('week 与 future 互斥：明天的任务只在本周分区，不进未来分区', async () => {
    await agent
      .post('/api/tasks')
      .send({ title: '明天的互斥任务', goal_id: goalId, scheduled_for: todayStr(1) })
      .expect(201)

    const week = await agent.get('/api/tasks?bucket=week').expect(200)
    expect(week.body.some((t: { title: string }) => t.title === '明天的互斥任务')).toBe(true)

    const future = await agent.get('/api/tasks?bucket=future').expect(200)
    expect(future.body.some((t: { title: string }) => t.title === '明天的互斥任务')).toBe(false)
  })

  it('30 天后的任务只进未来分区', async () => {
    await agent
      .post('/api/tasks')
      .send({ title: '远期任务', goal_id: goalId, scheduled_for: todayStr(30) })
      .expect(201)

    const week = await agent.get('/api/tasks?bucket=week').expect(200)
    expect(week.body.some((t: { title: string }) => t.title === '远期任务')).toBe(false)

    const future = await agent.get('/api/tasks?bucket=future').expect(200)
    expect(future.body.some((t: { title: string }) => t.title === '远期任务')).toBe(true)
  })
})
