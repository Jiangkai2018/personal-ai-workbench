import { test, expect } from '../fixture'

// 家庭互证找回密码：另一位家人验证 → 重置 → 新密码登录（global-setup 已建 jk / wife 两个家庭账号）
test('家人互证重置密码 → 新密码登录成功', async ({ page }) => {
  await page.goto('/')

  // 1. 打开找回表单
  await page.getByRole('button', { name: '忘记密码？家人互证找回' }).click()
  await expect(page.getByLabel('要重置的账号')).toBeVisible()

  // 2. 用 wife 的密码为 jk 重置
  await page.getByLabel('要重置的账号').fill('jk')
  await page.getByLabel('新密码', { exact: true }).fill('jk-new-password')
  await page.getByLabel('家人账号').fill('wife')
  await page.getByLabel('家人密码').fill('test-password')
  await page.getByRole('button', { name: '验证并重置' }).click()
  await expect(page.getByText('密码已重置，请用新密码登录')).toBeVisible()

  // 3. 旧密码失效
  await page.getByLabel('用户名').fill('jk')
  await page.getByLabel('密码').fill('test-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('用户名或密码错误')).toBeVisible()

  // 4. 新密码登录成功，进入工作台
  await page.getByLabel('密码').fill('jk-new-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByLabel('记录一个想法')).toBeVisible()

  // 5. 恢复测试账号密码（users/ 不随 fixture 清空，其他 spec 依赖 jk/test-password）
  await page.getByRole('button', { name: '退出' }).click()
  await page.getByRole('button', { name: '忘记密码？家人互证找回' }).click()
  await page.getByLabel('要重置的账号').fill('jk')
  await page.getByLabel('新密码', { exact: true }).fill('test-password')
  await page.getByLabel('家人账号').fill('wife')
  await page.getByLabel('家人密码').fill('test-password')
  await page.getByRole('button', { name: '验证并重置' }).click()
  await expect(page.getByText('密码已重置，请用新密码登录')).toBeVisible()
})

test('家人密码错误 → 拒绝重置，旧密码仍可登录', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '忘记密码？家人互证找回' }).click()

  await page.getByLabel('要重置的账号').fill('jk')
  await page.getByLabel('新密码', { exact: true }).fill('should-not-work')
  await page.getByLabel('家人账号').fill('wife')
  await page.getByLabel('家人密码').fill('wrong-family-password')
  await page.getByRole('button', { name: '验证并重置' }).click()

  // 403 → 错误码展示（client 回退到 body.error）
  await expect(page.getByText(/FAMILY_VERIFY_FAILED/)).toBeVisible()

  // 旧密码未受影响
  await page.getByRole('button', { name: '← 返回登录' }).click()
  await page.getByLabel('用户名').fill('jk')
  await page.getByLabel('密码').fill('test-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByLabel('记录一个想法')).toBeVisible()
})
