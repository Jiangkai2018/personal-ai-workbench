// 领域分析（e2e 屏蔽真实 AI）：发起 → 分析中 → 失败可重试的完整交互闭环
import { test, expect } from '../fixture'
import { login } from '../utils'

test('发起领域分析：AI 未配置时给出失败状态与重新分析入口', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: '机会' }).click()
  await page.getByRole('button', { name: '+ 新机会' }).click()
  await page.getByLabel('机会标题').fill('E2E 领域分析机会')
  await page.getByRole('button', { name: '创建机会' }).click()
  await expect(page.getByText('E2E 领域分析机会')).toBeVisible()

  // 发起分析（后台立即失败：AI 未配置）
  await page.getByRole('button', { name: '领域分析：E2E 领域分析机会' }).click()
  await expect(page.getByText('领域分析已启动', { exact: false })).toBeVisible()

  // 轮询（5s 间隔）后应显示失败标签 + 重新分析入口
  await expect(page.getByTitle(/AI 未配置/)).toBeVisible({ timeout: 20000 })
  await expect(
    page.getByRole('button', { name: '重新分析：E2E 领域分析机会' }),
  ).toBeVisible()
})
