// 测试助手：种子用户 + 返回已登录的 supertest agent（从公开接口走，不经内部后门）
import request from 'supertest'
import type { Express } from 'express'
import bcrypt from 'bcryptjs'
import { UserStore } from '../src/storage/userStore'

export const TEST_PASSWORD = 'test-password'

/** 建两个家庭成员账号（江凯 + 妻子），供登录测试使用 */
export async function seedUsers(dataDir: string): Promise<void> {
  const users = new UserStore(dataDir)
  const now = new Date().toISOString()
  await users.upsert({
    username: 'jk',
    name: '江凯',
    password_hash: await bcrypt.hash(TEST_PASSWORD, 4),
    family: true,
    created_at: now,
  })
  await users.upsert({
    username: 'wife',
    name: '妻子',
    password_hash: await bcrypt.hash(TEST_PASSWORD, 4),
    family: true,
    created_at: now,
  })
}

/** 登录并返回带 cookie 的 agent；后续请求直接用 agent.xxx() */
export async function loginAgent(app: Express, username = 'jk'): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app)
  await agent.post('/api/auth/login').send({ username, password: TEST_PASSWORD }).expect(200)
  return agent
}
