import { test, expect } from '../fixture'
import { login } from '../utils'

function dateOffset(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function createTask(page: import('@playwright/test').Page, title: string, scheduled: string) {
  await page.getByRole('button', { name: '+ 新任务' }).click()
  await page.getByLabel('任务标题').fill(title)
  await page.getByLabel('排期').fill(scheduled)
  await page.getByRole('button', { name: '创建任务' }).click()
  // 等待表单收起，避免下一次点开被 toggle 掉
  await expect(page.getByLabel('任务标题')).toBeHidden()
}

test('任务分区：今天/本周/未来 tab 过滤 + 勾选完成进归档 + 恢复', async ({ page }) => {
  await login(page)
  await page.goto('/tasks')

  // 三个维护任务（不挂目标）：今天 / 明天（本周）/ 30 天后（未来）
  await createTask(page, 'E2E 今天任务', dateOffset(0))
  await createTask(page, 'E2E 本周任务', dateOffset(1))
  await createTask(page, 'E2E 未来任务', dateOffset(30))

  // 今天 tab：只看到今天的
  await expect(page.getByText('E2E 今天任务')).toBeVisible()
  await expect(page.getByText('E2E 本周任务')).not.toBeVisible()
  await expect(page.getByText('E2E 未来任务')).not.toBeVisible()

  // 本周 tab：只看到明天的
  await page.getByRole('tab', { name: '本周' }).click()
  await expect(page.getByText('E2E 本周任务')).toBeVisible()
  await expect(page.getByText('E2E 今天任务')).not.toBeVisible()
  await expect(page.getByText('E2E 未来任务')).not.toBeVisible()

  // 未来 tab：只看到 30 天后的
  await page.getByRole('tab', { name: '未来' }).click()
  await expect(page.getByText('E2E 未来任务')).toBeVisible()
  await expect(page.getByText('E2E 本周任务')).not.toBeVisible()

  // 归档 tab：初始为空提示
  await page.getByRole('tab', { name: '归档' }).click()
  await expect(page.getByText('这个分区还没有任务。')).toBeVisible()

  // 回今天 tab 勾选完成 → 出现在归档
  await page.getByRole('tab', { name: '今天' }).click()
  await page.getByRole('button', { name: '完成：E2E 今天任务' }).click()
  await expect(page.getByText('E2E 今天任务')).not.toBeVisible()
  await page.getByRole('tab', { name: '归档' }).click()
  await expect(page.getByText('E2E 今天任务')).toBeVisible()

  // 归档里恢复 → 回到今天 tab
  await page.getByRole('button', { name: '恢复：E2E 今天任务' }).click()
  await expect(page.getByText('E2E 今天任务')).not.toBeVisible()
  await page.getByRole('tab', { name: '今天' }).click()
  await expect(page.getByText('E2E 今天任务')).toBeVisible()
})
