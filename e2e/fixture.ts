// 共享 fixture：每个用例前清空实体数据，保证测试完全隔离。
// 服务器无内存缓存、按请求读文件，直接清目录安全；users/ 保留以维持登录会话。
import { test as base } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'

const ENTITY_DIRS = ['ideas', 'goals', 'tasks', 'opportunities', 'reports', 'reviews']

export const test = base.extend({
  page: async ({ page }, use) => {
    const dir = path.join(import.meta.dirname, '.tmp-data')
    for (const sub of ENTITY_DIRS) {
      await rm(path.join(dir, sub), { recursive: true, force: true }).catch(() => {})
    }
    await use(page)
  },
})

export { expect } from '@playwright/test'
