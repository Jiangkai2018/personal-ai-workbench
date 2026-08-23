#!/usr/bin/env node
// 管理端建号（无自助注册）：npm run add-user -w server -- --username jk --password xxx --name 张三 --family
import path from 'node:path'
import { UserStore } from '../storage/userStore'
import { hashPassword } from '../auth/service'

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const username = typeof args.username === 'string' ? args.username : ''
  const password = typeof args.password === 'string' ? args.password : ''
  const name = typeof args.name === 'string' ? args.name : username

  if (!username || !password) {
    console.error('用法: add-user --username <登录名> --password <密码> [--name <显示名>] [--family]')
    process.exit(1)
  }

  const dataDir =
    process.env.WORKBENCH_DATA_DIR ||
    path.resolve(import.meta.dirname, '..', '..', '..', 'data')

  const users = new UserStore(dataDir)
  const existing = await users.get(username)
  await users.upsert({
    username,
    name,
    family: args.family === true,
    password_hash: await hashPassword(password),
    created_at: existing?.created_at ?? new Date().toISOString(),
  })
  console.log(`[add-user] 用户 ${username}（${name}）${existing ? '已更新' : '已创建'} → ${dataDir}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
