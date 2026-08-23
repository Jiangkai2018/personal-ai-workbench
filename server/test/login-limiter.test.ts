// 登录防爆破：阶梯锁定（3→3分钟 / 5→1小时 / 7→1周 / 10→永久）+ 成功清零 + 永久封禁持久化
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers } from './helpers'

// supertest 直连不走代理：req.ip = ::ffff:127.0.0.1，同一"客户端"——正好模拟单 IP 连续错
const wrongLogin = (app: ReturnType<typeof createApp>) =>
  request.agent(app).post('/api/auth/login').send({ username: 'jk', password: 'wrong' })

describe('登录防爆破：阶梯锁定', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  // fake timers 下 setTimeout 不会走真实事件循环；IO 落盘需要真实等待
  const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms))
  const realSetTimeout = globalThis.setTimeout

  beforeAll(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-23T12:00:00Z'))
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-'))
    await seedUsers(dataDir)
    app = createApp({ dataDir })
  })
  afterAll(async () => {
    vi.useRealTimers()
    await rm(dataDir, { recursive: true, force: true })
  })

  it('错 3 次 → 锁 3 分钟；锁定期间的尝试不消耗密码比对也不累计', async () => {
    for (let i = 0; i < 3; i++) await wrongLogin(app).expect(401)
    const locked = await wrongLogin(app).expect(429)
    expect(locked.body.message).toContain('分钟')
    expect(locked.body.error).toBe('TOO_MANY_ATTEMPTS')

    // 时间前进 3 分钟 → 解锁
    vi.advanceTimersByTime(3 * 60_000 + 1000)
    await wrongLogin(app).expect(401) // 第 4 次错误
  })

  it('第 5 次错误 → 锁 1 小时', async () => {
    vi.advanceTimersByTime(3 * 60_000 + 1000)
    await wrongLogin(app).expect(401) // 第 5 次
    const locked = await wrongLogin(app).expect(429)
    expect(locked.body.message).toContain('小时')

    vi.advanceTimersByTime(60 * 60_000 + 1000)
    await wrongLogin(app).expect(401) // 第 6 次
  })

  it('第 7 次错误 → 锁 1 周；第 10 次 → 永久封禁并落盘', async () => {
    vi.advanceTimersByTime(3 * 60_000 + 1000)
    await wrongLogin(app).expect(401) // 第 7 次
    await wrongLogin(app).expect(429)

    vi.advanceTimersByTime(7 * 24 * 60 * 60_000 + 1000)
    await wrongLogin(app).expect(401) // 第 8 次
    vi.advanceTimersByTime(3 * 60_000 + 1000)
    await wrongLogin(app).expect(401) // 第 9 次
    vi.advanceTimersByTime(3 * 60_000 + 1000)
    await wrongLogin(app).expect(401) // 第 10 次 → 永久

    const banned = await wrongLogin(app).expect(429)
    expect(banned.body.message).toContain('永久')

    // 永久封禁写进 data/security/banned.md（重启不丢）；等异步落盘完成
    let raw = ''
    for (let i = 0; i < 10 && !raw; i++) {
      await realSleep(30)
      raw = await readFile(path.join(dataDir, 'security', 'banned.md'), 'utf8').catch(() => '')
    }
    expect(raw).toContain('ips')
  })

  it('正确登录会清零计数（真人偶发输错不被累积）', async () => {
    // 独立 dataDir：避免加载上一用例持久化的同 IP 永久封禁
    const dataDir2 = await mkdtemp(path.join(tmpdir(), 'workbench-'))
    await seedUsers(dataDir2)
    const app2 = createApp({ dataDir: dataDir2 })
    await wrongLogin(app2).expect(401)
    await wrongLogin(app2).expect(401)
    await request(app2).post('/api/auth/login').send({ username: 'jk', password: 'test-password' }).expect(200)
    // 成功后再错 2 次（累计 2 < 3）→ 仍放行；第 3 次触锁，第 4 次被拒
    await wrongLogin(app2).expect(401)
    await wrongLogin(app2).expect(401)
    await wrongLogin(app2).expect(401) // 第 3 次：触发 3 分钟锁
    await wrongLogin(app2).expect(429) // 第 4 次：被锁拒绝
    await rm(dataDir2, { recursive: true, force: true })
  })
})
