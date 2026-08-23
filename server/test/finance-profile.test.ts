// 收支档案版本管理：保存归档 / 版本列表 / 恢复（不触网）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

const PROFILE_A = {
  incomes: [{ name: '工资', amount: 20000 }],
  fixedExpenses: [{ name: '房贷', amount: 5000 }],
  variableMonthly: 4000,
  initialSavings: 200000,
  annualRatePct: 3,
  years: 10,
}
const PROFILE_B = { ...PROFILE_A, incomes: [{ name: '工资', amount: 30000 }] }

describe('收支档案：持久化与版本管理', () => {
  let dataDir: string
  let agent: ReturnType<typeof request.agent>

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-'))
    await seedUsers(dataDir)
    agent = await loginAgent(createApp({ dataDir }))
  })
  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('保存 → 档案持久化，重读不丢', async () => {
    await agent.put('/api/finance/profile').send(PROFILE_A).expect(200)
    const got = await agent.get('/api/finance/profile').expect(200)
    expect(got.body.incomes[0].amount).toBe(20000)
  })

  it('再次保存 → 旧版自动归档，版本带其保存时的备注与关键数字', async () => {
    // 上一测试已存 A（无备注）；此处再存 A（带备注）→ 存 B → 应有两条归档，最新一条带备注
    await agent.put('/api/finance/profile').send({ ...PROFILE_A, note: '基线' }).expect(200)
    await agent.put('/api/finance/profile').send(PROFILE_B).expect(200)
    const versions = await agent.get('/api/finance/profile/versions').expect(200)
    expect(versions.body).toHaveLength(2)
    expect(versions.body[0].note).toBe('基线')
    // 归档的都是 A：月结余 20000-5000-4000=11000
    expect(versions.body[0].monthlySaving).toBe(11000)
    // 当前是 B
    const got = await agent.get('/api/finance/profile').expect(200)
    expect(got.body.incomes[0].amount).toBe(30000)
  })

  it('恢复版本 → 主档案回到旧版，且当前版也被归档（可来回切）', async () => {
    const versions = await agent.get('/api/finance/profile/versions').expect(200)
    const first = versions.body[0]

    const restored = await agent.post('/api/finance/profile/restore').send({ id: first.id }).expect(200)
    expect(restored.body.incomes[0].amount).toBe(20000) // 回到 A

    // 恢复前 B 也进版本库 → 现在三条；最新归档是 B（月结余 21000）
    const after = await agent.get('/api/finance/profile/versions').expect(200)
    expect(after.body).toHaveLength(3)
    expect(after.body[0].monthlySaving).toBe(21000)
  })

  it('非法版本 id 被拒', async () => {
    await agent.post('/api/finance/profile/restore').send({ id: 'finance-profile' }).expect(400)
    await agent.post('/api/finance/profile/restore').send({ id: 'finance-profile-vnonexist' }).expect(404)
  })
})
