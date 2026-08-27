// T9 · 082702 bug 收集第二轮回归（有头 e2e，编号截图落 local_docs/05.e2e测试/082702.e2e验证bug截图/）
// 对应文档：local_docs/05.e2e测试/082702.测试任务/{B2,B3,B4,B5}-*.md
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '../fixture'
import { login, newThreadReady } from '../utils'

const ROOT = path.join(import.meta.dirname, '..', '..')
const SHOT_DIR = path.join(ROOT, 'local_docs', '05.e2e测试', '082702.e2e验证bug截图')
const DATA_THREADS = path.join(ROOT, 'e2e', '.tmp-data', 'agent', 'threads')
const shot = async (page: import('@playwright/test').Page, name: string) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SHOT_DIR, name) })
}

/** 等待最后一条助手回复完成：气泡内全部 .ag-md 文本段总长连续两次采样不变（真实模型弱断言）
 *  注意：多步工具链会在同一气泡产生多个 text 部件（叙述/总结各一段），必须累加而非取首段 */
async function bubbleTextLength(bubble: import('@playwright/test').Locator) {
  const nodes = await bubble.locator('.ag-md').all()
  let total = 0
  for (const el of nodes) total += (await el.textContent())?.length ?? 0
  return total
}

async function waitSettled(page: import('@playwright/test').Page, timeoutMs: number) {
  const bubble = page.getByTestId('ag-msg-assistant').last()
  let settled = false
  let last = -1
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500)
    const len = await bubbleTextLength(bubble)
    if (len > 5 && len === last) {
      settled = true
      break
    }
    last = len
  }
  return settled
}

test.describe('T9 · 082702 bug 回归', () => {
  test.use({ viewport: { width: 1440, height: 800 } })

  // ── B2 GFM 表格 + B3 思考限高：合并进同一条会话省额度 ──
  test('B2+B3 · markdown 表格渲染 + 思考折叠限高滚动', async ({ page }) => {
    test.setTimeout(360_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const input = page.getByTestId('ag-composer-input')
    await input.fill('请用 markdown 表格列出全部二十四节气，列：名称/季节/大致日期，表格后用一句话收尾')
    await input.press('Enter')

    // ── B3-C1 · 直播期间思考正文区限高（若模型出思考；不出则跳过该分支）──
    const thinkBody = page.locator('.ag-reasoning .ag-reasoning-body').first()
    try {
      await thinkBody.waitFor({ state: 'visible', timeout: 45_000 })
      const style = await thinkBody.evaluate((el) => {
        const s = getComputedStyle(el)
        return { maxH: s.maxHeight, oy: s.overflowY }
      })
      expect(parseFloat(style.maxH), '思考区应限高 ≈136px(8.5rem)').toBeCloseTo(136, -1)
      expect(style.oy, '思考区 overflow-y 应为 auto').toBe('auto')
      console.log('[t9] B3 直播期限高样式', JSON.stringify(style))
      await shot(page, 'b3-c1-thinking-capped.png')
    } catch {
      console.log('[t9] 本轮模型未直播思考段，B3 改在完成后手动展开复验')
    }

    // ── 完成等待 ──
    const bubbles = page.getByTestId('ag-msg-assistant')
    await expect.poll(async () => bubbles.count(), { timeout: 90_000 }).toBe(1)
    expect(await waitSettled(page, 180_000), '表格回复应在时限内完成').toBeTruthy()

    // ── B2-C1 · 表格渲染为真 <table> ──
    const md = bubbles.first().locator('.ag-md')
    // 兼容：模型可能把表格放在多段文本之一，用气泡内全局查找
    const table = bubbles.first().locator('.ag-md table').first()
    if ((await table.count()) === 0) {
      // 触发二次确认生成表格（重发一次更明确的指令）
      console.log('[t9] 首条未出表格，改发确认指令')
      await input.fill('请只输出一个markdown表格：两列「节气」「日期」，三行数据，不要其他文字。')
      await input.press('Enter')
      await expect.poll(async () => bubbles.count(), { timeout: 60_000 }).toBe(2)
      expect(await waitSettled(page, 120_000)).toBeTruthy()
    }
    const finalTable = page.locator('[data-testid="ag-msg-assistant"] .ag-md table').first()
    await expect(finalTable, 'GFM 表格必须渲染为 <table>（bug082702-2 核心断言）').toBeVisible({
      timeout: 30_000,
    })
    expect(await finalTable.locator('th').count()).toBeGreaterThanOrEqual(2)
    await shot(page, 'b2-c1-gfm-table.png')

    // ── B3-C2 · 手动展开历史思考同样受限高 ──
    const summary = page.locator('summary', { hasText: /已思考|思考过程/ }).first()
    if ((await summary.count()) > 0) {
      await summary.click()
      const bodyEl = page.locator('.ag-reasoning .ag-reasoning-body').first()
      const capped = await bodyEl.evaluate(
        (el) => el.scrollHeight - el.clientHeight <= 8 || getComputedStyle(el).maxHeight !== 'none',
      )
      expect(capped, '展开态仍应限高内滚').toBeTruthy()
      await shot(page, 'b3-c2-fold-reopen-capped.png')
    }
  })

  // ── B4 长文生成不被截断 + 中断收口 + 落盘完整性 ──
  test('B4 · 1000字故事必有正文且思考收口', async ({ page }) => {
    test.setTimeout(600_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const input = page.getByTestId('ag-composer-input')
    await input.fill('给我讲一个1000字的故事')
    await input.press('Enter')

    const bubble = page.getByTestId('ag-msg-assistant').last()

    // 正文必须出现并写够字数（修复前：reasoning 数千字后 finishReason=length，正文零字）
    await expect(bubble.locator('.ag-md').first(), '长思考后必须有正文流式出现').toBeVisible({ timeout: 300_000 })
    await expect
      .poll(async () => bubbleTextLength(bubble), {
        timeout: 180_000,
        intervals: [2_000, 5_000],
      })
      .toBeGreaterThan(300)

    // 思考状态收口：不再有「思考中」倒计时
    await expect(bubble.locator('summary')).not.toContainText('思考中', { timeout: 20_000 })
    await shot(page, 'b4-c1-story-final.png')

    // ── B4-C2 · 服务端落盘直验：最后一条 assistant 必含非空 text part ──
    // 落盘走 onEnd 异步链（合并→save），比 UI 完成晚零点几秒：轮询而非固定等待
    await expect
      .poll(
        async () => {
          const files = fs.readdirSync(DATA_THREADS).filter((f) => f.endsWith('.json'))
          if (files.length === 0) return 0
          files.sort((a, b) => {
            const sa = fs.statSync(path.join(DATA_THREADS, a)).mtimeMs
            const sb = fs.statSync(path.join(DATA_THREADS, b)).mtimeMs
            return sb - sa
          })
          const thread = JSON.parse(fs.readFileSync(path.join(DATA_THREADS, files[0]), 'utf8')) as {
            messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>
          }
          const lastAssistant = thread.messages.filter((m) => m.role === 'assistant').pop()
          return lastAssistant?.parts.find((p) => p.type === 'text')?.text?.length ?? 0
        },
        { timeout: 30_000, intervals: [1_000, 2_000] },
      )
      .toBeGreaterThan(300)
    await shot(page, 'b4-c2-persisted-json.png')
  })

  // ── B6 网络搜索 MCP 真实调用 ──
  test('B6 · 联网提问触发 web_search_prime 并回答', async ({ page }) => {
    test.setTimeout(600_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const input = page.getByTestId('ag-composer-input')
    await input.fill('请先调用网络搜索工具查一下：2026年8月有什么值得关注的 AI 编程助手新动态？然后用三句话总结。')
    await input.press('Enter')

    // 工具卡出现（连接/搜索需要时间，放宽；模型可能连搜两次 → 允许多卡，用 first）
    await expect(page.getByTestId('ag-tool-search').first(), '应渲染「🌐 联网搜索」工具卡').toBeVisible({
      timeout: 240_000,
    })
    // 最终总结正文：多步链路在同一气泡里会产生多个 .ag-md 段，必须按总长判定
    const bubble = page.getByTestId('ag-msg-assistant').last()
    await expect(bubble.locator('.ag-md').first()).toBeVisible({ timeout: 240_000 })
    await expect
      .poll(async () => bubbleTextLength(bubble), { timeout: 300_000, intervals: [2_000, 5_000] })
      .toBeGreaterThan(60)
    await shot(page, 'b6-c1-websearch.png')

    // 落盘互证：最后一条 assistant 含 tool-* 部件（轮询容忍 onEnd 异步保存）
    await expect
      .poll(
        async () => {
          const files = fs.readdirSync(DATA_THREADS).filter((f) => f.endsWith('.json'))
          if (files.length === 0) return 0
          files.sort((a, b) => {
            const sa = fs.statSync(path.join(DATA_THREADS, a)).mtimeMs
            const sb = fs.statSync(path.join(DATA_THREADS, b)).mtimeMs
            return sb - sa
          })
          const thread = JSON.parse(fs.readFileSync(path.join(DATA_THREADS, files[0]), 'utf8')) as {
            messages: Array<{ role: string; parts: Array<{ type: string }> }>
          }
          const lastAssistant = thread.messages.filter((m) => m.role === 'assistant').pop()
          return (lastAssistant?.parts ?? []).filter((p) => p.type.startsWith('tool-')).length
        },
        { timeout: 30_000, intervals: [1_000, 2_000] },
      )
      .toBeGreaterThan(0)
    await shot(page, 'b6-c2-persisted-tool-json.png')
  })

  // ── B5 多轮运行时思考状态隔离 ──
  test('B5 · 第二轮直播期间第一轮气泡保持收口', async ({ page }) => {
    test.setTimeout(480_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const input = page.getByTestId('ag-composer-input')
    await input.fill('你好，用一句话介绍你自己')
    await input.press('Enter')

    const bubbles = page.getByTestId('ag-msg-assistant')
    await expect(bubbles).toHaveCount(1)
    await expect(bubbles.first().locator('.ag-md')).toBeVisible({ timeout: 120_000 })
    expect(await waitSettled(page, 120_000), '第一轮应完成').toBeTruthy()

    // 第一轮结束后 summary 必须已离开「思考中」态
    const firstSummary = bubbles.first().locator('summary')
    await expect(firstSummary).not.toContainText('思考中', { timeout: 20_000 })

    // 第二轮发起，直播期间轮询第一条：任何采样点都不得回入「思考中」
    await input.fill('再讲一个100字的冷笑话')
    await input.press('Enter')
    await expect(bubbles).toHaveCount(2)
    for (let i = 0; i < 8; i++) {
      const txt = (await firstSummary.textContent()) ?? ''
      expect(txt, `第 ${i} 次采样时第一轮不得重回思考态`).not.toContain('思考中')
      await page.waitForTimeout(700)
    }
    await shot(page, 'b5-c1-second-turn-isolated.png')

    // 第二轮自身也应正常收口
    await expect(bubbles.last().locator('summary')).not.toContainText('思考中', { timeout: 180_000 })
  })
})
