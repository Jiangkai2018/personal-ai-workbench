import { test, expect } from '../fixture'
import { login } from '../utils'

test('想法可编辑：改内容与轨道后保存生效', async ({ page }) => {
  await login(page)
  await page.getByLabel('记录一个想法').fill('E2E 待编辑的想法')
  await page.getByRole('button', { name: '记下' }).click()
  await page.getByRole('link', { name: '想法' }).click()

  await page.getByRole('button', { name: '编辑：E2E 待编辑的想法' }).click()
  const textarea = page.getByLabel('编辑想法内容')
  await expect(textarea).toHaveValue('E2E 待编辑的想法')
  await textarea.fill('E2E 已编辑的想法')
  await page.getByLabel('编辑轨道').selectOption('maintenance')
  await page.getByRole('button', { name: '保存' }).click()

  await expect(page.getByText('E2E 已编辑的想法')).toBeVisible()
  await expect(page.getByText('E2E 待编辑的想法')).not.toBeVisible()
  // 轨道标签同步为"维护"
  await expect(
    page.getByRole('listitem', { hasText: 'E2E 已编辑的想法' }).getByText('维护'),
  ).toBeVisible()
})

test('想法可删除：确认后从收件箱消失', async ({ page }) => {
  await login(page)
  await page.getByLabel('记录一个想法').fill('E2E 待删除的想法')
  await page.getByRole('button', { name: '记下' }).click()
  await page.getByRole('link', { name: '想法' }).click()
  await expect(page.getByText('E2E 待删除的想法')).toBeVisible()

  page.on('dialog', (d) => d.accept())
  await page.getByRole('button', { name: '删除：E2E 待删除的想法' }).click()

  await expect(page.getByText('E2E 待删除的想法')).not.toBeVisible()
})

test('已转正的想法不能删除（守卫提示）', async ({ page }) => {
  await login(page)
  await page.getByLabel('记录一个想法').fill('E2E 转正后不可删')
  await page.getByRole('button', { name: '记下' }).click()
  await page.getByRole('link', { name: '想法' }).click()

  // 一键直达转正（基线变更为真实模型：评分真调 GLM，约 5~15s，断言超时同步放宽）
  await page.getByRole('button', { name: '转正：E2E 转正后不可删' }).click()
  await expect(page.getByText(/已转正为机会/)).toBeVisible({ timeout: 30_000 })

  // 按钮变成"已转正"标签，没有删除入口
  const item = page.getByRole('listitem', { hasText: 'E2E 转正后不可删' })
  await expect(item.getByText('已转正')).toBeVisible()
  await expect(item.getByRole('button', { name: /删除/ })).toHaveCount(0)
})
