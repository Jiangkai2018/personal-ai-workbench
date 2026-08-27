// T10 · 0827-03 Agent 知识库工具链（有头 e2e，截图落 local_docs/05.e2e测试/082703.e2e验证截图/）
// C0 发送按钮可见性（bug082703）；C1 需求原文场景：调研北京外来务工政策 → 落盘 md 进 tmp 知识库
import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '../fixture'
import { login, newThreadReady } from '../utils'

const ROOT = path.join(import.meta.dirname, '..', '..')
const SHOT_DIR = path.join(ROOT, 'local_docs', '05.e2e测试', '082703.e2e验证截图')
const KB_ROOT = path.join(ROOT, 'e2e', '.tmp-data', 'knowledge')
const DATA_THREADS = path.join(ROOT, 'e2e', '.tmp-data', 'agent', 'threads')

const shot = async (page: import('@playwright/test').Page, name: string) => {
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SHOT_DIR, name) })
}

/** 重置 tmp 知识库并播种最小归位规则（fixture 不清 knowledge/，须自管隔离） */
function seedKb() {
  fs.rmSync(KB_ROOT, { recursive: true, force: true })
  fs.mkdirSync(KB_ROOT, { recursive: true })
  fs.writeFileSync(
    path.join(KB_ROOT, 'README.md'),
    '# AI 外脑知识库（e2e）\n\n01.决策档案/  活决策结论\n03.知识沉淀/  可复用知识\n99.归档/    过程稿\n',
    'utf8',
  )
  fs.writeFileSync(
    path.join(KB_ROOT, 'CLAUDE.md'),
    '# 归位规则（e2e）\n\n- 政策调研类 → 03.知识沉淀/04.政策调研/\n- 文件命名：主题-YYYYMMDD.md\n- 正文以 # 标题开头，网络调研须附「> 来源：」信源行\n',
    'utf8',
  )
}

/** 递归收集知识库下内容型 md（排除播种的规则文件） */
function listKbArticles(): string[] {
  if (!fs.existsSync(KB_ROOT)) return []
  const out: string[] = []
  const visit = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) visit(p)
      else if (name.endsWith('.md') && name !== 'README.md' && name !== 'CLAUDE.md') out.push(p)
    }
  }
  visit(KB_ROOT)
  return out
}

/** 等最后一条助手气泡文本总长连续两次采样不变（真实模型弱断言，同 t9） */
async function waitSettled(page: import('@playwright/test').Page, timeoutMs: number) {
  const bubble = page.getByTestId('ag-msg-assistant').last()
  let last = -1
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await page.waitForTimeout(1500)
    const nodes = await bubble.locator('.ag-md').all()
    let total = 0
    for (const el of nodes) total += (await el.textContent())?.length ?? 0
    if (total > 5 && total === last) return true
    last = total
  }
  return false
}

test.describe('T10 · 0827-03 知识库工具链', () => {
  test.use({ viewport: { width: 1440, height: 800 } })

  // ── C0 · 发送按钮可见性回归（bug082703：原先是空 children 不可见）──
  test('C0 · 发送按钮带图标可见且空输入禁用', async ({ page }) => {
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const send = page.getByTestId('ag-send')
    await expect(send, '发送按钮必须可见').toBeVisible()
    await expect(send.locator('svg'), '按钮内应有箭头图标').toBeVisible()
    await expect(send).toContainText('发送')
    expect(await send.isDisabled(), '空输入时应禁用').toBe(true)

    await page.getByTestId('ag-composer-input').fill('随便一句')
    expect(await send.isEnabled(), '有输入后应可用').toBe(true)
    await shot(page, 'c0-send-button-visible.png')
  })

  // ── C1 · 需求原文场景：调研 → 整合 → 落盘知识库 ──
  test('C1 · 调研北京外来务工政策并落盘 md', async ({ page }) => {
    test.setTimeout(900_000)
    seedKb()
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const input = page.getByTestId('ag-composer-input')
    await input.fill('帮我调研一下北京最新的政策，有对外来务工人员的福利吗？调研完毕后写入md，落盘到合适位置')
    await input.press('Enter')

    // 搜索工具卡出现（可能连搜多次，用 first）
    await expect(page.getByTestId('ag-tool-search').first(), '应出现联网搜索卡').toBeVisible({ timeout: 240_000 })

    // 落盘卡出现 = kb_write 真被调用（醒目卡）。出现即可截图：args（大正文）可能还在流式传输
    await expect(page.getByTestId('ag-tool-kb-write').first(), '应出现「📄 落盘」工具卡').toBeVisible({
      timeout: 420_000,
    })
    await shot(page, 'c1-kb-write-card.png')

    // 等落盘真正完成：卡片进入完成态「…字节已写入知识库」。
    // 千万不能用文本段稳定判收口——工具 args 流式期间文本段不变，会误判（T10 首轮教训）
    await expect(page.getByTestId('ag-tool-kb-write').first()).toContainText('已写入', { timeout: 600_000 })

    // 回合收口：总结正文出现 + 全部思考折叠离开「思考中」
    // （多步推理会在同一气泡产生多个 reasoning 折叠，locator('summary') 会 strict 冲突，须逐个取样拼接）
    expect(await waitSettled(page, 240_000), '落盘后应有总结正文').toBeTruthy()
    const summaries = page.getByTestId('ag-msg-assistant').last().locator('summary')
    await expect
      .poll(
        async () => {
          const n = await summaries.count()
          let txt = ''
          for (let i = 0; i < n; i++) txt += (await summaries.nth(i).textContent()) ?? ''
          return txt
        },
        { timeout: 60_000, intervals: [2_000, 5_000] },
      )
      .not.toContain('思考中')

    // 磁盘互证：知识库真实出现内容型 md（非播种文件），含标题与信源
    await expect
      .poll(
        async () => {
          const articles = listKbArticles()
          return articles.filter((p) => {
            const text = fs.readFileSync(p, 'utf8')
            return text.length > 300 && text.includes('#') && (text.includes('北京') || text.includes('务工'))
          }).length
        },
        { timeout: 60_000, intervals: [2_000, 5_000] },
      )
      .toBeGreaterThanOrEqual(1)
    const article = listKbArticles()[0]
    const persisted = fs.readFileSync(article, 'utf8')
    console.log(`[t10] 落盘文件：${path.relative(ROOT, article)}（${persisted.length} 字）`)
    expect(persisted, '落盘正文应注明信源').toMatch(/来源|来源：|参考|http/)
    await shot(page, 'c2-kb-persisted-md.png')

    // 会话 JSON 互证：最后一条 assistant 消息携带 kb 工具部件
    await expect
      .poll(
        async () => {
          const files = fs.readdirSync(DATA_THREADS).filter((f) => f.endsWith('.json'))
          if (!files.length) return 0
          files.sort((a, b) => fs.statSync(path.join(DATA_THREADS, b)).mtimeMs - fs.statSync(path.join(DATA_THREADS, a)).mtimeMs)
          const thread = JSON.parse(fs.readFileSync(path.join(DATA_THREADS, files[0]), 'utf8')) as {
            messages: Array<{ role: string; parts: Array<{ type: string }> }>
          }
          const last = thread.messages.filter((m) => m.role === 'assistant').pop()
          return (last?.parts ?? []).filter((p) => p.type.startsWith('tool-kb') || p.type === 'tool-web_search_prime').length
        },
        { timeout: 30_000, intervals: [1_000, 2_000] },
      )
      .toBeGreaterThanOrEqual(1)
    await shot(page, 'c3-thread-json-tool-parts.png')
  })
})
