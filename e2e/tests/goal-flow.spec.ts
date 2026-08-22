import { test, expect } from '../fixture'
import { login } from '../utils'

test('创建目标 → 首页快速添加今日任务挂目标 → 勾选完成进今日完成', async ({ page }) => {
  // 1. 创建目标
  await login(page)
  await page.goto('/goals')
  await page.getByRole('button', { name: '+ 新目标' }).click()
  await page.getByLabel('目标标题').fill('E2E 成长目标')
  await page.getByRole('button', { name: '创建目标' }).click()
  await expect(page.getByText('E2E 成长目标')).toBeVisible()

  // 2. 首页快速添加今日任务，挂到该目标
  await page.goto('/')
  await page.getByLabel('快速添加今日任务').fill('E2E 今日任务')
  await page.getByLabel('选择目标').selectOption({ label: 'E2E 成长目标' })
  await page.getByRole('button', { name: '加' }).click()
  await expect(page.getByText('E2E 今日任务')).toBeVisible()

  // 3. 勾选完成 → 移到"今日完成"，进度 100%
  await page.getByRole('button', { name: '完成：E2E 今日任务' }).click()
  await expect(page.getByText(/今日完成/)).toBeVisible()
  await expect(page.locator('ul.done').getByText('E2E 今日任务')).toBeVisible()
})
