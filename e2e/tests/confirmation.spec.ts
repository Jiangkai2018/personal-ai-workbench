import { test, expect } from '../fixture'
import { login } from '../utils'

test('想法转正全链路：想法 → 提案 → 确认中心批准 → 机会出现', async ({ page }) => {
  await login(page)

  // 1. 记一个想法
  await page.getByLabel('记录一个想法').fill('E2E 想试海外独立开发')
  await page.getByRole('button', { name: '记下' }).click()

  // 2. 想法页点"转正" → 生成提案
  await page.getByRole('link', { name: '想法' }).click()
  await page.getByRole('button', { name: '转正：E2E 想试海外独立开发' }).click()
  await expect(page.getByText(/已提交转正提案/)).toBeVisible()

  // 3. 确认中心出现待确认提案 + 角标
  await page.getByRole('link', { name: /确认/ }).click()
  await expect(page.getByText(/把想法「E2E 想试海外独立开发」转正为机会/)).toBeVisible()
  await expect(page.getByRole('button', { name: '批准' })).toBeVisible()

  // 4. 批准 → 机会页出现该机会（来自想法）
  await page.getByRole('button', { name: '批准' }).click()
  await expect(page.getByText(/已批准，文件操作已执行/)).toBeVisible()
  await page.getByRole('link', { name: '机会' }).click()
  await expect(page.getByText('E2E 想试海外独立开发')).toBeVisible()
  await expect(page.getByText('来自想法')).toBeVisible()
})

test('机会转正为目标全链路：机会 → 提案 → 批准 → 目标出现', async ({ page }) => {
  await login(page)

  // 1. 建一个高分机会
  await page.getByRole('link', { name: '机会' }).click()
  await page.getByRole('button', { name: '+ 新机会' }).click()
  await page.getByLabel('机会标题').fill('E2E 卖课副业')
  for (const dim of ['价值度', '可行度', '时间窗', '匹配度', '风险度']) {
    await page.getByLabel(`评分-${dim}`).fill('18')
  }
  await page.getByRole('button', { name: '创建机会' }).click()
  await expect(page.getByText('E2E 卖课副业')).toBeVisible()

  // 2. 机会页"转正为目标"
  await page.getByRole('button', { name: '转正为目标：E2E 卖课副业' }).click()
  await expect(page.getByText(/已提交「E2E 卖课副业」的转正提案/)).toBeVisible()

  // 3. 确认中心批准（唯一待确认提案）
  await page.getByRole('link', { name: /确认/ }).click()
  await page.getByRole('listitem', { hasText: 'E2E 卖课副业' }).getByRole('button', { name: '批准' }).click()

  // 4. 目标页出现
  await page.getByRole('link', { name: '目标' }).click()
  await expect(page.getByText('E2E 卖课副业')).toBeVisible()
})

test('驳回提案：不产生新实体', async ({ page }) => {
  await login(page)
  await page.getByLabel('记录一个想法').fill('E2E 不该转正的')
  await page.getByRole('button', { name: '记下' }).click()

  await page.getByRole('link', { name: '想法' }).click()
  await page.getByRole('button', { name: '转正：E2E 不该转正的' }).click()
  await page.getByRole('link', { name: /确认/ }).click()

  await page
    .getByRole('listitem', { hasText: 'E2E 不该转正的' })
    .getByRole('button', { name: '驳回' })
    .click()
  // 精确匹配 toast（避免同时命中「已处理」列表里的"已驳回 · 江凯"标签）
  await expect(page.getByText('已驳回', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '机会' }).click()
  await expect(page.getByText('E2E 不该转正的')).not.toBeVisible()
})
