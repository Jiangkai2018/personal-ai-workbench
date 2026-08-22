import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

describe('转正提案 + 确认中心 —— 承诺类动作必须用户确认后才生效', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  let agent: ReturnType<typeof request.agent>

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-prop-'))
    await seedUsers(dataDir)
    app = createApp({ dataDir })
    agent = await loginAgent(app)
  })
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('从想法发起转正提案：status=pending，summary 含想法内容', async () => {
    const idea = await agent
      .post('/api/ideas')
      .send({ content: '想试试小红书带货', track: 'growth' })
      .expect(201)

    const res = await agent
      .post('/api/proposals')
      .send({ action: 'promote_idea_to_opportunity', source_id: idea.body.id })
      .expect(201)

    expect(res.body).toMatchObject({
      type: 'proposal',
      action: 'promote_idea_to_opportunity',
      status: 'pending',
      source_type: 'idea',
      source_id: idea.body.id,
    })
    expect(res.body.summary).toContain('小红书带货')
    expect(res.body.payload.title).toBe('想试试小红书带货')
  })

  it('同一想法重复提案 → 409', async () => {
    const idea = await agent
      .post('/api/ideas')
      .send({ content: '只转正一次', track: 'growth' })
      .expect(201)
    await agent
      .post('/api/proposals')
      .send({ action: 'promote_idea_to_opportunity', source_id: idea.body.id })
      .expect(201)
    await agent
      .post('/api/proposals')
      .send({ action: 'promote_idea_to_opportunity', source_id: idea.body.id })
      .expect(409)
  })

  it('提案源不存在 → 400', async () => {
    await agent
      .post('/api/proposals')
      .send({ action: 'promote_idea_to_opportunity', source_id: 'nope' })
      .expect(400)
  })

  it('从机会发起转目标提案：可带目标参数', async () => {
    const opp = await agent
      .post('/api/opportunities')
      .send({ title: '独立开发', scores: { value: 19, feasible: 16, window: 15, fit: 20, risk: 16 } })
      .expect(201)

    const res = await agent
      .post('/api/proposals')
      .send({
        action: 'promote_opportunity_to_goal',
        source_id: opp.body.id,
        description: '每周 10 小时',
        milestones: ['v0 出海'],
      })
      .expect(201)

    expect(res.body.summary).toContain('独立开发')
    expect(res.body.payload).toMatchObject({
      title: '独立开发',
      description: '每周 10 小时',
      milestones: ['v0 出海'],
    })
  })

  it('批准想法→机会提案：创建机会文件 + 提案 approved + decided_by', async () => {
    const idea = await agent
      .post('/api/ideas')
      .send({ content: '给娃做 AI 学习工具', track: 'growth' })
      .expect(201)
    const prop = await agent
      .post('/api/proposals')
      .send({ action: 'promote_idea_to_opportunity', source_id: idea.body.id })
      .expect(201)

    const res = await agent.post(`/api/proposals/${prop.body.id}/approve`).expect(200)
    expect(res.body.status).toBe('approved')
    expect(res.body.decided_by).toBe('江凯')

    // 机会文件落地，回填 source_idea_id
    const opportunities = await agent.get('/api/opportunities').expect(200)
    const promoted = opportunities.body.find((o: { source_idea_id: string }) => o.source_idea_id === idea.body.id)
    expect(promoted).toBeTruthy()
    expect(promoted.title).toBe('给娃做 AI 学习工具')

    // 想法被打上 promoted_to_id
    const ideas = await agent.get('/api/ideas').expect(200)
    const src = ideas.body.find((i: { id: string }) => i.id === idea.body.id)
    expect(src.promoted_to_id).toBe(promoted.id)
  })

  it('批准机会→目标提案：创建目标 + 机会回填 goal_id', async () => {
    const opp = await agent
      .post('/api/opportunities')
      .send({ title: '卖课副业', scores: { value: 18, feasible: 17, window: 16, fit: 18, risk: 15 } })
      .expect(201)
    const prop = await agent
      .post('/api/proposals')
      .send({ action: 'promote_opportunity_to_goal', source_id: opp.body.id, milestones: ['第一门课'] })
      .expect(201)

    const res = await agent.post(`/api/proposals/${prop.body.id}/approve`).expect(200)
    expect(res.body.status).toBe('approved')

    const goals = await agent.get('/api/goals').expect(200)
    const goal = goals.body.find((g: { title: string }) => g.title === '卖课副业')
    expect(goal).toBeTruthy()
    expect(goal.milestones).toEqual(['第一门课'])

    const opportunities = await agent.get('/api/opportunities').expect(200)
    const src = opportunities.body.find((o: { id: string }) => o.id === opp.body.id)
    expect(src.goal_id).toBe(goal.id)
  })

  it('重复批准 → 409', async () => {
    const idea = await agent
      .post('/api/ideas')
      .send({ content: '重复批准测试', track: 'growth' })
      .expect(201)
    const prop = await agent
      .post('/api/proposals')
      .send({ action: 'promote_idea_to_opportunity', source_id: idea.body.id })
      .expect(201)
    await agent.post(`/api/proposals/${prop.body.id}/approve`).expect(200)
    await agent.post(`/api/proposals/${prop.body.id}/approve`).expect(409)
  })

  it('驳回提案：标记 rejected，不创建任何实体', async () => {
    const idea = await agent
      .post('/api/ideas')
      .send({ content: '不该转正', track: 'growth' })
      .expect(201)
    const prop = await agent
      .post('/api/proposals')
      .send({ action: 'promote_idea_to_opportunity', source_id: idea.body.id })
      .expect(201)

    const res = await agent.post(`/api/proposals/${prop.body.id}/reject`).expect(200)
    expect(res.body.status).toBe('rejected')

    const opportunities = await agent.get('/api/opportunities').expect(200)
    expect(opportunities.body.some((o: { source_idea_id: string }) => o.source_idea_id === idea.body.id)).toBe(false)
  })

  it('确认中心按 status 过滤', async () => {
    const pending = await agent.get('/api/proposals?status=pending').expect(200)
    expect(pending.body.length).toBeGreaterThan(0)
    expect(pending.body.every((p: { status: string }) => p.status === 'pending')).toBe(true)
  })

  it('提案落盘为 .md 文件', async () => {
    const files = await readdir(path.join(dataDir, 'proposals'))
    expect(files.length).toBeGreaterThan(0)
  })
})
