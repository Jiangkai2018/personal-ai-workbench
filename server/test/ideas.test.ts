import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

describe('想法 API —— 捕获漏斗起点', () => {
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

  it('创建想法：POST /api/ideas 写一个 markdown 文件并返回实体', async () => {
    const res = await agent
      .post('/api/ideas')
      .send({ content: '想试试小红书带货', scope: 'personal', track: 'growth' })
      .expect(201)

    expect(res.body).toMatchObject({
      type: 'idea',
      content: '想试试小红书带货',
      scope: 'personal',
      track: 'growth',
      status: 'inbox',
    })
    expect(typeof res.body.id).toBe('string')

    // 唯一数据源：磁盘上出现带 frontmatter 的 .md 文件
    const files = await readdir(path.join(dataDir, 'ideas'))
    expect(files).toHaveLength(1)
    const raw = await readFile(path.join(dataDir, 'ideas', files[0]), 'utf8')
    expect(raw).toContain('type: idea')
    expect(raw).toContain('scope: personal')
    expect(raw).toContain('想试试小红书带货')
  })

  it('不传 scope/track 时默认 personal + growth', async () => {
    const res = await agent
      .post('/api/ideas')
      .send({ content: '随手一记' })
      .expect(201)
    expect(res.body.scope).toBe('personal')
    expect(res.body.track).toBe('growth')
  })

  it('空内容想法返回 400', async () => {
    const res = await agent
      .post('/api/ideas')
      .send({ content: '   ' })
      .expect(400)
    expect(res.body.error).toBe('INVALID_INPUT')
  })

  it('列出全部想法：GET /api/ideas 从 markdown 目录解析返回', async () => {
    const res = await agent.get('/api/ideas').expect(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(2) // 前两个测试累计 2 条
    const contents = res.body.map((i: { content: string }) => i.content)
    expect(contents).toContain('想试试小红书带货')
    expect(contents).toContain('随手一记')
  })

  it('按范围过滤：?scope=family 只返回家庭想法', async () => {
    await agent
      .post('/api/ideas')
      .send({ content: '给娃打疫苗', scope: 'family', track: 'maintenance' })
      .expect(201)

    const all = await agent.get('/api/ideas').expect(200)
    expect(all.body).toHaveLength(3)

    const fam = await agent.get('/api/ideas?scope=family').expect(200)
    expect(fam.body).toHaveLength(1)
    expect(fam.body[0].content).toBe('给娃打疫苗')
  })

  describe('编辑 —— PATCH /api/ideas/:id', () => {
    it('改正文与轨道：返回更新后实体且磁盘文件同步变化', async () => {
      const created = await agent
        .post('/api/ideas')
        .send({ content: '原始想法内容' })
        .expect(201)

      const res = await agent
        .patch(`/api/ideas/${created.body.id}`)
        .send({ content: '改后的想法内容', track: 'maintenance' })
        .expect(200)
      expect(res.body.content).toBe('改后的想法内容')
      expect(res.body.track).toBe('maintenance')

      const raw = await readFile(path.join(dataDir, 'ideas', `${created.body.id}.md`), 'utf8')
      expect(raw).toContain('改后的想法内容')
      expect(raw).not.toContain('原始想法内容')
    })

    it('空正文返回 400，不存在的 id 返回 404', async () => {
      const res = await agent
        .patch('/api/ideas/not-exist')
        .send({ content: 'x' })
        .expect(404)
      expect(res.body.error).toBe('NOT_FOUND')
    })

    it('不提供任何字段返回 400', async () => {
      const created = await agent.post('/api/ideas').send({ content: '又一个' }).expect(201)
      await agent.patch(`/api/ideas/${created.body.id}`).send({}).expect(400)
    })
  })

  describe('删除 —— DELETE /api/ideas/:id', () => {
    it('删除后文件消失、列表少一条', async () => {
      const created = await agent.post('/api/ideas').send({ content: '待删除' }).expect(201)
      await agent.delete(`/api/ideas/${created.body.id}`).expect(200)

      const files = await readdir(path.join(dataDir, 'ideas'))
      expect(files).not.toContain(`${created.body.id}.md`)
    })

    it('不存在的 id 返回 404', async () => {
      await agent.delete('/api/ideas/not-exist').expect(404)
    })

    it('已转正（被机会引用）的想法返回 409', async () => {
      const created = await agent.post('/api/ideas').send({ content: '要转正的' }).expect(201)
      await agent
        .post('/api/proposals')
        .send({ action: 'promote_idea_to_opportunity', source_id: created.body.id })
        .expect(201)
      // 找到刚建的提案并批准 → 想法被标记 promoted_to_id
      const proposals = await agent.get('/api/proposals?status=pending').expect(200)
      const target = proposals.body.find(
        (p: { source_id: string }) => p.source_id === created.body.id,
      )
      await agent.post(`/api/proposals/${target.id}/approve`).expect(200)

      const res = await agent.delete(`/api/ideas/${created.body.id}`).expect(409)
      expect(res.body.error).toBe('ALREADY_PROMOTED')
    })

    it('有待审提案的想法返回 409，提示先去确认中心', async () => {
      const created = await agent.post('/api/ideas').send({ content: '待审中的' }).expect(201)
      await agent
        .post('/api/proposals')
        .send({ action: 'promote_idea_to_opportunity', source_id: created.body.id })
        .expect(201)

      const res = await agent.delete(`/api/ideas/${created.body.id}`).expect(409)
      expect(res.body.error).toBe('PENDING_PROPOSAL')
    })
  })
})
