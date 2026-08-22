import { test, expect } from '../fixture'
import { login } from '../utils'

function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

test('晚间复盘全链路：勾选完成 → 开始复盘 → 日小结 + 目标进度更新 + 时间线', async ({ page }) => {
  await login(page)
  const today = todayStr()

  // 1. 建目标 + 挂 2 件今日任务
  await page.getByRole('link', { name: '目标' }).click()
  await page.getByRole('button', { name: '+ 新目标' }).click()
  await page.getByLabel('目标标题').fill('E2E 复盘目标')
  await page.getByRole('button', { name: '创建目标' }).click()
  await expect(page.getByText('E2E 复盘目标')).toBeVisible()

  await page.getByRole('link', { name: '任务' }).click()
  await page.getByRole('button', { name: '+ 新任务' }).click()
  await page.getByLabel('任务标题').fill('E2E 复盘任务A')
  await page.getByLabel('挂靠目标').selectOption({ label: 'E2E 复盘目标' })
  await page.getByLabel('排期').fill(today)
  await page.getByRole('button', { name: '创建任务' }).click()
  // 表单创建后收起，再开一次建任务 B
  await page.getByRole('button', { name: '+ 新任务' }).click()
  await page.getByLabel('任务标题').fill('E2E 复盘任务B')
  await page.getByLabel('挂靠目标').selectOption({ label: 'E2E 复盘目标' })
  await page.getByLabel('排期').fill(today)
  await page.getByRole('button', { name: '创建任务' }).click()

  // 2. 首页勾选完成这 2 件（今天分区）
  await page.getByRole('link', { name: '今日' }).click()
  await page.getByRole('button', { name: '完成：E2E 复盘任务A' }).click()
  await page.getByRole('button', { name: '完成：E2E 复盘任务B' }).click()

  // 3. 开始复盘
  await page.getByRole('button', { name: '开始复盘' }).click()
  await expect(page.getByText(/完成 2 件事，已写复盘/)).toBeVisible()

  // 4. 目标进度更新（0 → 20）
  await page.getByRole('link', { name: '目标' }).click()
  await expect(page.getByText(/20%/)).toBeVisible()

  // 5. 复盘时间线出现日小结
  await page.getByRole('link', { name: '复盘' }).click()
  await expect(page.getByText('E2E 复盘任务A')).toBeVisible()
  await expect(page.getByText(/E2E 复盘目标：0% → 20%/)).toBeVisible()
})
