import { test, expect } from '../fixture'
import { login } from '../utils'

test('目标进度滑块：调整后刷新页面仍持久化', async ({ page }) => {
  await login(page)
  await page.goto('/goals')

  // 1. 建目标（初始 0%）
  await page.getByRole('button', { name: '+ 新目标' }).click()
  await page.getByLabel('目标标题').fill('E2E 滑块目标')
  await page.getByRole('button', { name: '创建目标' }).click()
  await expect(page.getByText('E2E 滑块目标')).toBeVisible()
  await expect(page.getByText('0%').first()).toBeVisible()

  // 2. 拖动滑块到 40（onChange 每次触发都会 PATCH）
  const slider = page.getByLabel('调整进度')
  await slider.fill('40')
  await expect(page.getByText('40%').first()).toBeVisible()

  // 3. 刷新页面 → 从文件重新读取，进度仍是 40%
  await page.reload()
  await expect(page.getByText('E2E 滑块目标')).toBeVisible()
  await expect(page.getByText('40%').first()).toBeVisible()
  // 滑块本身也回到 40
  await expect(page.getByLabel('调整进度')).toHaveValue('40')

  // 4. 再调到 75 并持久化验证
  await page.getByLabel('调整进度').fill('75')
  await expect(page.getByText('75%').first()).toBeVisible()
  await page.reload()
  await expect(page.getByText('75%').first()).toBeVisible()
})
