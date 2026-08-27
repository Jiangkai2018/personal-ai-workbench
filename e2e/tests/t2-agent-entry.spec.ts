// T2 · Agent 入口与页面骨架：入口位置、路由跳转、三栏布局、受保护路由、移动端降级
import { test, expect } from '../fixture'
import { login } from '../utils'

const DESKTOP = { viewport: { width: 1440, height: 900 } }

test.describe('T2 桌面骨架', () => {
  test.use(DESKTOP)

  test('C1+C2 · 入口在 scope-toggle 右侧；点击进入 /agent 空态三栏', async ({ page }) => {
    await login(page)

    const agentLink = page.getByLabel('进入 AI Agent')
    await expect(agentLink).toBeVisible()
    await expect(agentLink).toHaveAttribute('href', /\/agent$/)

    // DOM 顺序：「个人」「家庭」「✦ Agent」相邻且 Agent 在家庭右侧
    const order = await page.evaluate(() => {
      const wrap = document.querySelector('.scope-toggle')
      if (!wrap) return []
      return [...wrap.querySelectorAll<HTMLElement>('button, a')].map((el) => el.textContent?.trim())
    })
    expect(order.slice(-3)).toEqual(['个人', '家庭', '✦ Agent'])

    await agentLink.click()
    await expect(page).toHaveURL(/\/agent$/)
    await expect(page.getByText('开始一段新对话')).toBeVisible()
    await expect(page.getByText('点击新建，或在左侧选择历史会话继续')).toBeVisible()
    await expect(page.getByRole('button', { name: '＋ 新建对话' })).toBeVisible()
    await expect(page.getByText('还没有会话')).toBeVisible()
    // xl 宽度下右栏把手可见；默认收起（面板文案隐藏），展开后可见、可收起
    const previewHandle = page.getByRole('button', { name: '展开产物预览' })
    await expect(previewHandle).toBeVisible()
    await expect(page.getByText('一句话即可落盘进知识库')).toBeHidden()
    await previewHandle.click()
    await expect(page.getByText('一句话即可落盘进知识库')).toBeVisible()
    await page.getByRole('button', { name: '收起产物预览' }).click()
    await expect(page.getByText('一句话即可落盘进知识库')).toBeHidden()
  })

  test('C3 · 未登录直接访问 /agent → 落回登录页', async ({ page }) => {
    await page.goto('/agent')
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('开始一段新对话')).toHaveCount(0)
  })
})

test.describe('T2 C4 · 移动端降级（默认项目视口 390×844）', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('左右栏隐藏，出现移动端头部条，无横向滚动', async ({ page }) => {
    await login(page)
    await page.goto('/agent')

    await expect(page.getByTestId('ag-new-thread-mobile')).toBeVisible() // 「＋ 新建」
    await expect(page.getByTestId('ag-new-thread')).toBeHidden() // 桌面新建按钮不可见
    await expect(page.getByLabel('展开产物预览')).toBeHidden() // 右栏（含把手）整体隐藏

    const hScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hScroll, '不得出现横向滚动').toBeFalsy()
  })
})
