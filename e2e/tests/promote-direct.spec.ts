// 直达转正（确认中心已移除）：想法→机会、机会→目标 一键完成；AI 未配置时的提示
import { test, expect } from '../fixture'
import { login } from '../utils'

test('想法一键转正为机会：无需确认，直接出现在机会页', async ({ page }) => {
  await login(page)
  await page.getByLabel('记录一个想法').fill('E2E 直达转正想法')
  await page.getByRole('button', { name: '记下' }).click()
  await page.getByRole('link', { name: '想法' }).click()

  await page.getByRole('button', { name: '转正：E2E 直达转正想法' }).click()
  await expect(page.getByText(/已转正为机会/)).toBeVisible()

  await page.getByRole('link', { name: '机会' }).click()
  await expect(page.getByText('E2E 直达转正想法')).toBeVisible()
  await expect(page.getByText('来自想法')).toBeVisible()
})

test('机会一键转正为目标：直接出现在目标页', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: '机会' }).click()
  await page.getByRole('button', { name: '+ 新机会' }).click()
  await page.getByLabel('机会标题').fill('E2E 直达转正机会')
  await page.getByRole('button', { name: '创建机会' }).click()
  await expect(page.getByText('E2E 直达转正机会')).toBeVisible()

  await page.getByRole('button', { name: '转正为目标：E2E 直达转正机会' }).click()
  await expect(page.getByText('已转正为目标')).toBeVisible()

  await page.getByRole('link', { name: '目标' }).click()
  await expect(page.getByText('E2E 直达转正机会')).toBeVisible()
})

test('AI 未配置时点「AI 预评」给出可读提示（不崩溃）', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: '机会' }).click()
  await page.getByRole('button', { name: '+ 新机会' }).click()
  await page.getByLabel('机会标题').fill('E2E AI 未配置')
  await page.getByRole('button', { name: 'AI 预评' }).click()

  await expect(page.getByText(/AI 未配置/)).toBeVisible()
})
