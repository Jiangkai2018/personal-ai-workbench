#!/usr/bin/env node
// 服务器 CLI 兜底（双方同时忘记密码时管理员手动重置）：
// npm run reset-password -w server -- --username jk --password new-pass
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
  if (!username || !password) {
    console.error('用法: reset-password --username <登录名> --password <新密码>')
    process.exit(1)
  }

  const dataDir =
    process.env.WORKBENCH_DATA_DIR ||
    path.resolve(import.meta.dirname, '..', '..', '..', 'data')

  const users = new UserStore(dataDir)
  const existing = await users.get(username)
  if (!existing) {
    console.error(`[reset-password] 用户不存在: ${username}`)
    process.exit(1)
  }
  await users.upsert({ ...existing, password_hash: await hashPassword(password) })
  console.log(`[reset-password] ${username} 密码已重置 → ${dataDir}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
