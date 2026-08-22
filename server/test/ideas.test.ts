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
})
