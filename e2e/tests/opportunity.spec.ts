import { test, expect } from '../fixture'
import { login } from '../utils'

test('新建机会 → 5 维打分 → 显示总分与分档标签', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: '机会' }).click()

  await page.getByRole('button', { name: '+ 新机会' }).click()
  await page.getByLabel('机会标题').fill('E2E 小红书带货')

  // 五个滑块都拉到高分（range input 用 fill 设值）
  for (const dim of ['价值度', '可行度', '时间窗', '匹配度', '风险度']) {
    await page.getByLabel(`评分-${dim}`).fill('18')
  }

  // 草稿总分 90
  await expect(page.getByText('速评总分：')).toBeVisible()
  await page.getByRole('button', { name: '创建机会' }).click()

  // 出现在列表，分档 = 转正候选
  await expect(page.getByText('E2E 小红书带货')).toBeVisible()
  await expect(page.getByText('转正候选')).toBeVisible()
  await expect(page.getByText(/总分 90/)).toBeVisible()
})

test('低分机会 → 归档标签；拖动滑块可实时重打分档', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: '机会' }).click()

  await page.getByRole('button', { name: '+ 新机会' }).click()
  await page.getByLabel('机会标题').fill('E2E 奶茶店')
  for (const dim of ['价值度', '可行度', '时间窗', '匹配度', '风险度']) {
    await page.getByLabel(`评分-${dim}`).fill('15')
  }
  await page.getByRole('button', { name: '创建机会' }).click()

  // 15×5=75 → 观察池
  await expect(page.getByText('观察池')).toBeVisible()
  await expect(page.getByText(/总分 75/)).toBeVisible()

  // 拖动"价值度"滑块到 20 → 75-15+20=80 → 变转正候选
  await page.getByLabel('调整-价值度-E2E 奶茶店').fill('20')
  await expect(page.getByText('转正候选')).toBeVisible()
  await expect(page.getByText(/总分 80/)).toBeVisible()
})
