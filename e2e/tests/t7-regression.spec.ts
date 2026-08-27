// T7 · 回归抽查与登出收尾：Agent 板块上银不破坏既有闭环（想法/任务/财务/范围切换）+ 控制台巡检 + 登出
// 注意：本文件必须是整套 e2e 的最后执行项（防爆破预算已在 T1-C2 用掉 1 次，这里不再制造失败登录）
import { test, expect } from '../fixture'
import { login } from '../utils'

test('C1 既有闭环抽查（想法 → 任务 → 财务 → 范围切换）+ 控制台零异常 + 登出', async ({ page }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

  await login(page)

  // ── a · 想法捕获 ──
  await page.getByLabel('记录一个想法').fill('回归探针想法')
  await page.getByRole('button', { name: '记下' }).click()
  await page.getByRole('link', { name: '想法' }).click()
  await expect(page.getByText('回归探针想法')).toBeVisible()

  // ── b · 任务勾选进归档 ──
  const today = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const scheduled = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`
  await page.getByRole('link', { name: '任务' }).click()
  await page.getByRole('button', { name: '+ 新任务' }).click()
  await page.getByLabel('任务标题').fill('回归探针任务')
  await page.getByLabel('排期').fill(scheduled)
  await page.getByRole('button', { name: '创建任务' }).click()
  await expect(page.getByLabel('任务标题')).toBeHidden()
  await page.getByRole('button', { name: '完成：回归探针任务' }).click()
  await expect(page.getByText('回归探针任务')).not.toBeVisible()
  await page.getByRole('tab', { name: '归档' }).click()
  await expect(page.getByText('回归探针任务')).toBeVisible()

  // ── c · 财务模块可达 ──
  await page.getByRole('link', { name: '财务' }).click()
  await expect(page.locator('h2.page-title')).toHaveText('财务')
  await expect(page.locator('main')).toContainText(/\S/) // 有实质内容渲染

  // ── d · 个人/家庭范围切换 ──
  await page.getByRole('tab', { name: '家庭' }).click()
  await page.getByRole('tab', { name: '个人' }).click()
  await expect(page.getByText('测试甲')).toBeVisible() // 切换过程无崩溃

  // ── C3 · 控制台零未捕获异常（放行已知的未登录 401 / favicon 404 资源类报错）──
  const realErrors = errors.filter((e) => !/^(Failed to load resource)/.test(e))
  expect(realErrors, '无未捕获异常').toEqual([])

  // ── 收尾 · 登出回登录页 ──
  await page.getByLabel('退出登录').click()
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible()
})
