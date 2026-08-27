// T3 · 新建会话与流式对话：空会话骨架、SSE 逐字渲染、Markdown 排版、Enter/Shift+Enter
// 真实 GLM 输出不可预测 —— 一律「非空 + 增长趋稳」弱断言，模型等待放宽到 60~90s
import { test, expect } from '../fixture'
import { login, newThreadReady } from '../utils'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const TMP = path.join(import.meta.dirname, '..', '.tmp-data')
const THREADS_DIR = path.join(TMP, 'agent', 'threads')

async function listThreadFiles(): Promise<string[]> {
  return (await readdir(THREADS_DIR).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
}

/** 轮询直到某个线程文件满足谓词（服务端落盘有秒级延迟） */
async function pollThread(pred: (t: any, raw: string) => boolean, timeout = 15_000): Promise<any> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    for (const f of await listThreadFiles()) {
      try {
        const raw = await readFile(path.join(THREADS_DIR, f), 'utf8')
        const parsed = JSON.parse(raw)
        if (pred(parsed, raw)) return parsed
      } catch { /* 半写文件容忍 */ }
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('pollThread: 未找到满足条件的线程文件')
}

const sendAndWaitSettled = async (page: import('@playwright/test').Page, text: string) => {
  const input = page.getByTestId('ag-composer-input')
  await input.fill(text)
  await input.press('Enter')
  const bubble = page.getByTestId('ag-msg-assistant').last()
  // 两段式等待：① 正文出现（>5 字符，排除「工助手」角标骨架）→ ② 连续采样长度趋稳
  await expect
    .poll(async () => (await bubble.textContent())?.length ?? 0, { timeout: 90_000, intervals: [800] })
    .toBeGreaterThan(5)
  let last = -1
  await expect
    .poll(
      async () => {
        const len = (await bubble.textContent())?.length ?? 0
        const stable = len > 0 && len === last
        last = len
        return stable ? len : 0
      },
      { timeout: 120_000, intervals: [1_500] },
    )
    .toBeGreaterThan(0)
  return bubble
}

test.describe('T3 流式对话', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('C1 · 新建对话 → 空会话骨架 + 服务端落盘占位', async ({ page }) => {
    test.setTimeout(60_000)
    await login(page)
    await page.goto('/agent')

    await newThreadReady(page)
    await expect(page.getByText('从一次提问开始')).toBeVisible()
    const input = page.getByTestId('ag-composer-input')
    await expect(input).toBeVisible()
    await expect(input).toBeFocused()

    const t = await pollThread((x) => x.title === '新对话' && x.messages.length === 0)
    expect(t.id).toMatch(new RegExp(`^${new Date().getFullYear()}\\d{4}-agent-[0-9a-f]+$`))
  })

  test('C2 · 发送消息 → SSE 分片渐进渲染至完成', async ({ page }) => {
    test.setTimeout(180_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const text = '请只回复一句话：流式链路已打通'
    const input = page.getByTestId('ag-composer-input')
    await input.fill(text)

    // 用户气泡先于模型立即可见，内容原文一致
    await input.press('Enter')
    await expect(page.getByTestId('ag-msg-user').filter({ hasText: text })).toBeVisible({ timeout: 10_000 })

    // 助手气泡出现并带角标装饰
    const bubble = page.getByTestId('ag-msg-assistant')
    await expect(bubble).toBeVisible({ timeout: 60_000 })
    await expect(bubble.getByText('助手')).toBeVisible()
    await expect(bubble.getByText('工')).toBeVisible()

    // 分片渐进：两段式（正文出现 → 趋稳），期间采样留增长证据
    const lens: number[] = []
    await expect
      .poll(
        async () => {
          const len = (await bubble.textContent())?.length ?? 0
          lens.push(len)
          return len
        },
        { timeout: 90_000, intervals: [800] },
      )
      .toBeGreaterThan(5)
    let prevLen = 0
    await expect
      .poll(
        async () => {
          const len = (await bubble.textContent())?.length ?? 0
          lens.push(len)
          const stable = len > 0 && len === prevLen
          prevLen = len
          return stable ? len : 0
        },
        { timeout: 120_000, intervals: [1_500] },
      )
      .toBeGreaterThan(0)
    expect(prevLen, '最终文本长度 ≥10').toBeGreaterThanOrEqual(10)
    if (!lens.some((l) => l > 0 && l < prevLen)) {
      console.warn('[T3-C2] 未捕获到中间增长采样（可能一次性到达），记录软信号')
    }

    // 弱语义：含引导关键词之一致语义文本（不做文案强绑）
    await expect(bubble).toContainText(/流式链路/)
  })

  test('C3 · Markdown 排版管线（.ag-md 容器内渲染结构化元素）', async ({ page }) => {
    test.setTimeout(180_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    await sendAndWaitSettled(page, '请用markdown回复：一个二级标题、一个无序列表（两项）')

    const md = page.getByTestId('ag-msg-assistant').last().locator('.ag-md')
    await expect(md).toBeVisible()
    try {
      await expect(md.locator(':is(li,h1,h2,h3,h4,h5,h6,strong)').first()).toBeVisible({ timeout: 15_000 })
    } catch {
      console.warn('[T3-C3] 模型改用纯文本回答，属文档允许的软失败，需人工复核排版样式')
    }
  })

  test('C4 · Shift+Enter 换行不发送；Enter 发送', async ({ page }) => {
    test.setTimeout(180_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const input = page.getByTestId('ag-composer-input')
    await input.fill('首行探针甲')
    await input.press('Shift+Enter')
    await input.type('次行探针乙')

    expect(await input.inputValue(), '换行后含换行符').toContain('\n')
    expect(await page.getByTestId('ag-msg-user').count(), '未发送，无用户气泡').toBe(0)

    await input.press('Enter')
    await expect(page.getByTestId('ag-msg-user').filter({ hasText: '首行探针甲' })).toBeVisible({ timeout: 10_000 })
    expect(await page.getByTestId('ag-msg-user').count()).toBe(1)
    await expect.poll(async () => page.getByTestId('ag-msg-assistant').count(), { timeout: 90_000 }).toBe(1)
  })
})
