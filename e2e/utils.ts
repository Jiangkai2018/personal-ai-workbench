import type { Page } from '@playwright/test'

/** 登录（测试共用账号：jk / test-password），登录成功后停在首页 */
export async function login(page: Page, username = 'jk', password = 'test-password') {
  await page.goto('/')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByLabel('记录一个想法').waitFor()
}
