import { test, expect } from '../fixture'
import { login } from '../utils'

test('家庭范围：想法带"家庭"标签，个人范围下不显示', async ({ page }) => {
  await login(page)
  await page.getByRole('tab', { name: '家庭' }).click()

  await page.getByLabel('记录一个想法').fill('给娃打疫苗')
  await page.getByRole('button', { name: '记下' }).click()

  await page.getByRole('link', { name: '想法' }).click()
  await expect(page.getByText('给娃打疫苗')).toBeVisible()
  await expect(page.locator('li', { hasText: '给娃打疫苗' }).getByText('家庭')).toBeVisible()

  // 切回个人范围，家庭想法不可见
  await page.getByRole('tab', { name: '个人' }).click()
  await expect(page.getByText('给娃打疫苗')).not.toBeVisible()
})
