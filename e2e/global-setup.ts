// e2e 开始前：清空临时数据目录 + 用管理端 CLI 建两个家庭成员账号（无自助注册）
import { rm, mkdir } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import path from 'node:path'

export default async function globalSetup() {
  const dir = path.join(import.meta.dirname, '.tmp-data')
  const root = path.resolve(import.meta.dirname, '..')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  // 走真实的 add-user CLI，顺便验证建号脚本
  const addUser = (args: string) =>
    execSync(`npx tsx server/src/cli/add-user.ts ${args}`, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, WORKBENCH_DATA_DIR: dir },
    })
  addUser('--username jk --password test-password --name 测试甲 --family')
  addUser('--username wife --password test-password --name 测试乙 --family')

  console.log(`[global-setup] 已初始化 e2e 数据目录（含测试账号 jk/wife）: ${dir}`)
}
