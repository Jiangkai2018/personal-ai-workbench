// 财务页：凭证卡片状态 + 未配置引导 + 非法文件可读报错（不触真实随手记）
import { test, expect } from '../fixture'
import { login } from '../utils'

test('财务页：凭证卡片展示，未配置时引导填入 token', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: '财务' }).click()

  await expect(page.getByText('随手记连接')).toBeVisible()
  await expect(page.getByRole('tab', { name: '账单导入' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '月度报告' })).toBeVisible()
  await expect(page.getByRole('tab', { name: '财务推演' })).toBeVisible()

  // e2e 数据目录无 Web 凭证且 .env 无 SSJ token → 未配置态：显示表单，按钮在空输入时禁用
  if (await page.getByText('未配置').isVisible()) {
    await expect(page.getByLabel('随手记 token')).toBeVisible()
    await expect(page.getByRole('button', { name: '保存并验证' })).toBeDisabled()
  }
})

test('财务页：上传非账单文件给出可读错误', async ({ page }) => {
  await login(page)
  await page.getByRole('link', { name: '财务' }).click()

  await page.getByLabel('账单文件').setInputFiles({
    name: 'fake.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a bill'),
  })
  await expect(page.getByText('不支持的账单文件')).toBeVisible()
})

test('推演档案：保存后重开页面数据不丢，且支持版本归档与恢复', async ({ page }) => {
  await login(page)
  await page.goto('/finance')
  await page.getByRole('tab', { name: '财务推演' }).click()

  // 第一次保存
  await page.getByRole('button', { name: '+ 加一笔收入' }).click()
  await page.getByLabel('收入名0').fill('测试工资')
  await page.getByLabel('收入额0').fill('25000')
  await page.getByLabel('版本备注').fill('e2e 基线')
  await page.getByRole('button', { name: '保存并重算' }).click()
  await expect(page.getByText(/已保存 · 月结余 ¥25,000/)).toBeVisible()

  // 第二次保存（改金额）→ 旧版自动归档，版本历史出现
  await page.getByLabel('收入额0').fill('30000')
  await page.getByRole('button', { name: '保存并重算' }).click()
  await expect(page.getByText(/已保存 · 月结余 ¥30,000/)).toBeVisible()
  await expect(page.getByRole('button', { name: /恢复版本/ }).first()).toBeVisible()
  await expect(page.getByText('「e2e 基线」')).toBeVisible()

  // 重进页面（模拟重开）——回归点：旧实现挂载即 PUT 空档案，会清掉数据
  await page.goto('/finance')
  await page.getByRole('tab', { name: '财务推演' }).click()

  await expect(page.getByLabel('收入名0')).toHaveValue('测试工资')
  await expect(page.getByLabel('收入额0')).toHaveValue('30000')
})
