import { test, expect } from '../fixture'
import { login } from '../utils'

test('首页快捷捕获想法 → 出现在想法收件箱', async ({ page }) => {
  await login(page)
  // 铁律：首页 3 秒内完成"记一个想法"
  await page.getByLabel('记录一个想法').fill('想试试小红书带货')
  await page.getByRole('button', { name: '记下' }).click()

  await page.getByRole('link', { name: '想法' }).click()
  await expect(page.getByText('想试试小红书带货')).toBeVisible()
})

test('空想法不能提交', async ({ page }) => {
  await login(page)
  await expect(page.getByRole('button', { name: '记下' })).toBeDisabled()
})
