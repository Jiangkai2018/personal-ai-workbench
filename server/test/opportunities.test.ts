import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

describe('机会 API —— 5 维速评（价值/可行/时间窗/匹配/风险 × 0-20）', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  let agent: ReturnType<typeof request.agent>

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-opp-'))
    await seedUsers(dataDir)
    app = createApp({ dataDir })
    agent = await loginAgent(app)
  })
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('创建机会：5 维求和为总分，高分行档为转正候选（≥80）', async () => {
    const res = await agent
      .post('/api/opportunities')
      .send({
        title: '小红书带货',
        scope: 'personal',
        scores: { value: 18, feasible: 15, window: 16, fit: 19, risk: 17 },
      })
      .expect(201)

    expect(res.body).toMatchObject({
      type: 'opportunity',
      title: '小红书带货',
      total: 85, // 18+15+16+19+17
      status: 'candidate',
    })
    expect(res.body.scores.value).toBe(18)
  })

  it('60-79 分 → 观察池', async () => {
    const res = await agent
      .post('/api/opportunities')
      .send({
        title: '副业卖课',
        scores: { value: 14, feasible: 12, window: 13, fit: 15, risk: 10 },
      })
      .expect(201)
    expect(res.body.total).toBe(64)
    expect(res.body.status).toBe('observing')
  })

  it('<60 分 → 归档', async () => {
    const res = await agent
      .post('/api/opportunities')
      .send({
        title: '开奶茶店',
        scores: { value: 12, feasible: 8, window: 10, fit: 9, risk: 6 },
      })
      .expect(201)
    expect(res.body.total).toBe(45)
    expect(res.body.status).toBe('archived')
  })

  it('不传 scores 默认全 0 → 总分 0，归档', async () => {
    const res = await agent
      .post('/api/opportunities')
      .send({ title: '还没评分的想法' })
      .expect(201)
    expect(res.body.total).toBe(0)
    expect(res.body.status).toBe('archived')
  })

  it('单维越界（>20 或 <0）→ 400', async () => {
    await agent
      .post('/api/opportunities')
      .send({ title: '越界', scores: { value: 25 } })
      .expect(400)
  })

  it('机会写入带 frontmatter 的 .md 文件（唯一数据源）', async () => {
    const files = await readdir(path.join(dataDir, 'opportunities'))
    expect(files.length).toBeGreaterThan(0)
    const raw = await readFile(path.join(dataDir, 'opportunities', files[0]), 'utf8')
    expect(raw).toContain('type: opportunity')
    expect(raw).toContain('total:')
    expect(raw).toContain('status:')
  })

  it('PATCH 更新评分 → 重算总分与分档', async () => {
    const created = await agent
      .post('/api/opportunities')
      .send({ title: '可变分', scores: { value: 13, feasible: 13, window: 13, fit: 13, risk: 13 } })
      .expect(201)
    expect(created.body.status).toBe('observing') // 65 分 → 观察池

    const res = await agent
      .patch(`/api/opportunities/${created.body.id}`)
      .send({ scores: { value: 20, feasible: 20, window: 20, fit: 20, risk: 20 } })
      .expect(200)
    expect(res.body.total).toBe(100)
    expect(res.body.status).toBe('candidate')
  })

  it('按 scope 过滤列出机会', async () => {
    await agent
      .post('/api/opportunities')
      .send({ title: '家庭机会', scope: 'family', scores: { value: 18, feasible: 18, window: 18, fit: 18, risk: 18 } })
      .expect(201)

    const fam = await agent.get('/api/opportunities?scope=family').expect(200)
    expect(fam.body.length).toBeGreaterThan(0)
    expect(fam.body.every((o: { scope: string }) => o.scope === 'family')).toBe(true)

    const personal = await agent.get('/api/opportunities?scope=personal').expect(200)
    expect(personal.body.every((o: { scope: string }) => o.scope === 'personal')).toBe(true)
  })

  it('带来源想法创建机会（source_idea_id 回填）', async () => {
    const idea = await agent
      .post('/api/ideas')
      .send({ content: '想做独立开发', track: 'growth' })
      .expect(201)

    const res = await agent
      .post('/api/opportunities')
      .send({ title: '独立开发', source_idea_id: idea.body.id, scores: { value: 19, feasible: 16, window: 15, fit: 20, risk: 16 } })
      .expect(201)
    expect(res.body.source_idea_id).toBe(idea.body.id)
  })
})
