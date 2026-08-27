// T8 · Agent UX 验证（无头 e2e + 编号截图落 local_docs/08.e2e测试/0801.e2e验证截图/）
// 覆盖：内滚自动跟随 / 上滑脱离+回底按钮 / 思考流式展开收起 / 预览收放 / 加宽布局
import path from 'node:path'
import { test, expect } from '../fixture'
import { login, newThreadReady } from '../utils'

const SHOT_DIR = path.join(import.meta.dirname, '..', '..', 'local_docs', '08.e2e测试', '0801.e2e验证截图')
const shot = (page: import('@playwright/test').Page, name: string) =>
  page.screenshot({ path: path.join(SHOT_DIR, name) })

const metrics = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const vp = document.getElementById('ag-viewport') as HTMLElement | null
    if (!vp) return null
    return {
      scrollTop: Math.round(vp.scrollTop),
      scrollHeight: vp.scrollHeight,
      clientHeight: vp.clientHeight,
      atBottom: Math.abs(vp.scrollHeight - vp.scrollTop - vp.clientHeight) <= 32,
    }
  })

test.describe('T8 Agent UX 截图验证', () => {
  // 720 高：压缩视口高度，让「表格长回复」确定性地产生可交互溢出
  test.use({ viewport: { width: 1440, height: 720 } })

  test('对话跟随 / 思考流式 / 预览收放 / 加宽布局', async ({ page }) => {
    test.setTimeout(420_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    // ── 发送一条「会触发思考 + markdown 长答案」的消息 ──
    const input = page.getByTestId('ag-composer-input')
    await input.fill('9.11 和 9.8 哪个大？请一步步仔细推理，再用 markdown 给出结论和两个生活中的例子')
    await input.press('Enter')

    // ── 04 · 思考过程流式自动展开（呼吸点 + 思考中…）──
    const thinking = page.locator('details.ag-reasoning[open]')
    await expect(thinking, 'GLM 应输出思考段（若偶发跳过请重跑）').toBeVisible({ timeout: 40_000 })
    await expect(thinking.locator('summary')).toContainText('思考中')
    await shot(page, '04.思考过程流式自动展开.png')

    // ── 01 · 流式期间（思考直播或正文）视口内滚 + 自动跟随 ──
    // 从发送起持续采样：只要出现过「溢出且贴底」即证明内滚与跟随同时成立
    let followed = false
    let lastSample = ''
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      await page.waitForTimeout(500)
      const m = await metrics(page)
      if (!m) break
      lastSample = JSON.stringify(m)
      if (m.scrollHeight - m.clientHeight > 40 && m.atBottom) {
        followed = true
        break
      }
      if ((await page.getByTestId('ag-msg-assistant').count()) > 0) {
        const settled = await page.evaluate(() => {
          const d = document.querySelector('details.ag-reasoning')
          return d && !d.open ? true : false
        })
        if (settled) break // 思考已收起且仍未溢出 → 短回复，走加长流程
      }
    }
    if (!followed) console.log(`[t8] 跟随采样未命中，最后采样: ${lastSample}`)
    expect(followed, `流式期间应溢出且贴底跟随；最后采样 ${lastSample}`).toBeTruthy()
    await shot(page, '01.对话内容自动跟随最新消息.png')

    // ── 05 · 思考完成自动收起为「已思考 Ns」──
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const d = document.querySelector('details.ag-reasoning:not([open]) summary')
            return d?.textContent ?? ''
          }),
        { timeout: 60_000, intervals: [1_000] },
      )
      .toMatch(/已思考 \d+s/)
    await shot(page, '05.思考完成自动收起为已思考Ns.png')

    // ── 追加一条「24 节气表」长回复，保证内容高度确定性地超出视口 ──
    await newThreadReady(page)
    const input2 = page.getByTestId('ag-composer-input')
    await input2.fill('请用 markdown 表格列出全部二十四节气，列：名称/季节/大致日期/农事要点，表格后用一句话收尾')
    await input2.press('Enter')
    const bubbles2 = page.getByTestId('ag-msg-assistant')
    await expect.poll(async () => bubbles2.count(), { timeout: 90_000 }).toBe(1)
    let settled2 = false
    let last = -1
    const deadline2 = Date.now() + 150_000
    while (Date.now() < deadline2) {
      await page.waitForTimeout(1_500)
      const len = (await bubbles2.last().textContent())?.length ?? 0
      if (len > 5 && len === last) {
        settled2 = true
        break
      }
      last = len
    }
    expect(settled2, '第二条回复应在时限内完成').toBeTruthy()
    const m2 = await metrics(page)
    console.log(`[t8] 第二条完成时 metrics: ${JSON.stringify(m2)}`)
    expect(m2?.atBottom, '长回复完成后应贴底（自动跟随）').toBeTruthy()
    expect(
      (m2!.scrollHeight ?? 0) - (m2!.clientHeight ?? 0) > 40,
      '表格回复应使视口溢出（胶囊测试前提）',
    ).toBeTruthy()

    // ── 02 · 上滑脱离 → 浮出「回到底部」胶囊 ──
    await page.evaluate(() => {
      const vp = document.getElementById('ag-viewport') as HTMLElement
      vp.scrollTop = 0
    })
    const pill = page.getByRole('button', { name: '↓ 回到底部' })
    await expect(pill).toBeVisible({ timeout: 5_000 })
    await shot(page, '02.上滑脱离跟随后浮出回底按钮.png')

    // ── 03 · 点击胶囊恢复贴底 ──
    await pill.click()
    await expect
      .poll(async () => (await metrics(page))?.atBottom ?? false, { timeout: 10_000, intervals: [300] })
      .toBe(true)
    await expect(pill).toBeHidden()
    await shot(page, '03.点击回到底部恢复贴底.png')

    // ── 06 · 产物预览默认收起为右缘把手 ──
    const previewHandle = page.getByRole('button', { name: '展开产物预览' })
    await expect(previewHandle).toBeVisible()
    await expect(page.getByText('一句话即可落盘进知识库')).toBeHidden()
    await shot(page, '06.产物预览默认收起为右缘把手.png')

    // ── 07 · 点击把手展开面板 ──
    await previewHandle.click()
    await expect(page.getByText('一句话即可落盘进知识库')).toBeVisible()
    await shot(page, '07.产物预览展开态.png')

    // ── 08 · Agent 页加宽布局（--app-max 宽档生效）──
    const appWidth = await page.evaluate(
      () => (document.querySelector('.app') as HTMLElement).getBoundingClientRect().width,
    )
    expect(appWidth, 'Agent 页 .app 应切到宽档').toBeGreaterThanOrEqual(1180)
    await shot(page, '08.Agent页加宽布局.png')
  })
})
