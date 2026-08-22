import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, TEST_PASSWORD } from './helpers'

describe('鉴权 —— 账号密码 + JWT httpOnly cookie + 家庭互证找回', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-auth-'))
    await seedUsers(dataDir)
    app = createApp({ dataDir })
  })
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('登录成功：返回用户（不含密码哈希）+ httpOnly cookie', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'jk', password: TEST_PASSWORD })
      .expect(200)

    expect(res.body.username).toBe('jk')
    expect(res.body.password_hash).toBeUndefined()
    const cookie = res.headers['set-cookie']?.[0] ?? ''
    expect(cookie).toContain('workbench_session=')
    expect(cookie).toContain('HttpOnly')
  })

  it('密码错误 → 401', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'jk', password: 'wrong-password' })
      .expect(401)
  })

  it('不存在的用户 → 401（不暴露账号是否存在）', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'nobody', password: 'whatever' })
      .expect(401)
  })

  it('未登录访问受保护接口 → 401', async () => {
    await request(app).get('/api/ideas').expect(401)
    await request(app).post('/api/ideas').send({ content: 'x' }).expect(401)
    await request(app).get('/api/today').expect(401)
  })

  it('GET /api/auth/me 无 cookie → 401，有 cookie → 返回当前用户', async () => {
    await request(app).get('/api/auth/me').expect(401)

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'jk', password: TEST_PASSWORD })
    const cookie = login.headers['set-cookie']?.[0]
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie).expect(200)
    expect(me.body.username).toBe('jk')
    expect(me.body.family).toBe(true)
  })

  it('登录后带 cookie 可创建想法，登出后 cookie 失效', async () => {
    const agent = request.agent(app)
    await agent.post('/api/auth/login').send({ username: 'jk', password: TEST_PASSWORD }).expect(200)

    const created = await agent.post('/api/ideas').send({ content: '登录后的想法' }).expect(201)
    expect(created.body.content).toBe('登录后的想法')

    await agent.post('/api/auth/logout').expect(200)
    // 登出后不再有 cookie，写操作被拒
    await agent.post('/api/ideas').send({ content: '登出后不行' }).expect(401)
  })

  it('互证找回：家人密码验证通过后重置，审计日志落盘，新旧密码切换生效', async () => {
    await request(app)
      .post('/api/auth/reset-password')
      .send({
        username: 'jk',
        new_password: 'brand-new-pass',
        family_username: 'wife',
        family_password: TEST_PASSWORD,
      })
      .expect(200)

    // 新密码可登录
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'jk', password: 'brand-new-pass' })
      .expect(200)
    // 旧密码失效
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'jk', password: TEST_PASSWORD })
      .expect(401)

    // 审计日志：data/audit/ 下应有记录
    const auditDir = path.join(dataDir, 'audit')
    const files = await readdir(auditDir)
    expect(files.length).toBeGreaterThan(0)
    const raw = await readFile(path.join(auditDir, files[files.length - 1]), 'utf8')
    expect(raw).toContain('reset_password')
    expect(raw).toContain('target=jk')
    expect(raw).toContain('verified_by=wife')
  })

  it('家人密码错误 → 403，不重置', async () => {
    await request(app)
      .post('/api/auth/reset-password')
      .send({
        username: 'wife',
        new_password: 'valid-new-pass',
        family_username: 'jk',
        family_password: 'wrong-password',
      })
      .expect(403)
    // 原密码仍可登录
    await request(app)
      .post('/api/auth/login')
      .send({ username: 'wife', password: TEST_PASSWORD })
      .expect(200)
  })

  it('不能用自己的密码验证自己 → 403', async () => {
    await request(app)
      .post('/api/auth/reset-password')
      .send({
        username: 'jk',
        new_password: 'valid-new-pass',
        family_username: 'jk',
        family_password: TEST_PASSWORD,
      })
      .expect(403)
  })

  it('目标用户不存在 → 404', async () => {
    await request(app)
      .post('/api/auth/reset-password')
      .send({
        username: 'nobody',
        new_password: 'valid-new-pass',
        family_username: 'wife',
        family_password: TEST_PASSWORD,
      })
      .expect(404)
  })
})
