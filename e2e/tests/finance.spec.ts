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
