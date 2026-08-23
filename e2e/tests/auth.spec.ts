import { test, expect } from '../fixture'
import { login } from '../utils'

test('未登录访问首页 → 显示登录页，看不到工作台', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByLabel('用户名')).toBeVisible()
  await expect(page.getByLabel('记录一个想法')).not.toBeVisible()
})

test('未登录的写请求被拒（API 401）', async ({ page }) => {
  const res = await page.request.post('/api/ideas', { data: { content: '未登录' } })
  expect(res.status()).toBe(401)
})

test('登录成功 → 进入首页，顶栏显示用户名', async ({ page }) => {
  await login(page)
  await expect(page.getByText(/今日要做的/)).toBeVisible()
  await expect(page.getByText('测试甲')).toBeVisible()
})

test('密码错误 → 提示用户名或密码错误', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('用户名').fill('jk')
  await page.getByLabel('密码').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('用户名或密码错误')).toBeVisible()
})

test('退出登录 → 回到登录页', async ({ page }) => {
  await login(page)
  await page.getByRole('button', { name: '退出' }).click()
  await expect(page.getByLabel('用户名')).toBeVisible()
})
