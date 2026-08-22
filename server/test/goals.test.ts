import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

describe('目标 API —— 承诺投入的方向', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  let agent: ReturnType<typeof request.agent>

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-'))
    await seedUsers(dataDir)
    app = createApp({ dataDir })
    agent = await loginAgent(app)
  })
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('创建目标：POST /api/goals 写文件，含 title/里程碑/进度/描述', async () => {
    const res = await agent
      .post('/api/goals')
      .send({
        title: 'AI 成长系统',
        scope: 'personal',
        track: 'growth',
        description: '把工作台闭环跑起来',
        milestones: ['v0 闭环', 'v1 Agent'],
      })
      .expect(201)

    expect(res.body).toMatchObject({
      type: 'goal',
      title: 'AI 成长系统',
      scope: 'personal',
      track: 'growth',
      status: 'active',
      progress: 0,
      milestones: ['v0 闭环', 'v1 Agent'],
      content: '把工作台闭环跑起来',
    })

    const files = await readdir(path.join(dataDir, 'goals'))
    expect(files).toHaveLength(1)
    const raw = await readFile(path.join(dataDir, 'goals', files[0]), 'utf8')
    expect(raw).toContain('title: AI 成长系统')
    expect(raw).toContain('把工作台闭环跑起来')
  })

  it('列出目标：GET /api/goals 按最新在前返回', async () => {
    await agent
      .post('/api/goals')
      .send({ title: '家庭财务安全' })
      .expect(201)

    const res = await agent.get('/api/goals').expect(200)
    expect(res.body).toHaveLength(2)
    expect(res.body[0].title).toBe('家庭财务安全') // 新的在前
  })

  it('更新目标：PATCH /api/goals/:id 改进度/里程碑/状态', async () => {
    const created = await agent
      .post('/api/goals')
      .send({ title: '读书计划', milestones: ['第一章'] })
      .expect(201)
    const id = created.body.id

    const res = await agent
      .patch(`/api/goals/${id}`)
      .send({ progress: 40, milestones: ['第一章', '第二章'], description: '每周 2 本' })
      .expect(200)

    expect(res.body.progress).toBe(40)
    expect(res.body.milestones).toEqual(['第一章', '第二章'])
    expect(res.body.content).toBe('每周 2 本')

    // 唯一数据源校验：文件里确实更新了
    const raw = await readFile(path.join(dataDir, 'goals', `${id}.md`), 'utf8')
    expect(raw).toContain('progress: 40')
    expect(raw).toContain('每周 2 本')
  })

  it('更新不存在的目标返回 404', async () => {
    await agent.patch('/api/goals/nonexistent-id').send({ progress: 10 }).expect(404)
  })
})
