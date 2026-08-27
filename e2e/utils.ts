import { expect, type Page } from '@playwright/test'

/** 登录（测试共用账号：jk / test-password），登录成功后停在首页 */
export async function login(page: Page, username = 'jk', password = 'test-password') {
  await page.goto('/')
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill(password)
  await page.getByRole('button', { name: '登录' }).click()
  await page.getByLabel('记录一个想法').waitFor()
}

/** 新建会话并等待新 runtime 就绪：「＋ 新建对话」是异步的（建号→setActive→重挂载），
 *  必须等 autoFocus 落在新 composer 上再输入，否则消息会打进尚未卸载的旧会话（竞态） */
export async function newThreadReady(page: Page) {
  await page.getByTestId('ag-new-thread').click()
  const composer = page.getByTestId('ag-composer-input')
  await expect(composer).toBeFocused({ timeout: 15_000 })
  await expect(composer).toHaveValue('')
}
