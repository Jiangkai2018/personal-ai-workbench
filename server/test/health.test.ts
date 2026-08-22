import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/api/app'

describe('健康检查 —— /api/health', () => {
  it('无需登录即可探活，返回 ok 与运行时长', async () => {
    // health 路由不触盘，dataDir 随便给一个不存在的路径也不影响
    const app = createApp({ dataDir: 'unused' })
    const res = await request(app).get('/api/health').expect(200)
    expect(res.body.ok).toBe(true)
    expect(typeof res.body.uptime).toBe('number')
  })
})
