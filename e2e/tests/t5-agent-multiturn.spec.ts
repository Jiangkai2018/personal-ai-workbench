// T5 · 多轮上下文与标题派生：两轮消息合并落盘、刷新回放完整性、usage 捕获、空输入防御
// 真实 GLM 轮次正确性用「气泡数量 + 落盘 role 序列」判定；C1~C4 共享同一线程 → 合并单测内顺序执行
import { test, expect } from '../fixture'
import { login, newThreadReady } from '../utils'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const THREADS_DIR = path.join(import.meta.dirname, '..', '.tmp-data', 'agent', 'threads')

async function listThreadFiles(): Promise<string[]> {
  return (await readdir(THREADS_DIR).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
}

test.describe('T5 多轮上下文', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('C1→C4 · 两轮落盘 4 条 / 刷新回放完整 / usage 非空 / 空输入防御', async ({ page }) => {
    test.setTimeout(360_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const send = async (text: string) => {
      const input = page.getByTestId('ag-composer-input')
      await input.fill(text)
      await input.press('Enter')
    }
    const waitSettledLast = async () => {
      const bubble = page.getByTestId('ag-msg-assistant').last()
      // 两段式：正文出现 → 长度趋稳（见 t3 同款说明）
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
    }

    // ── C1：两轮对话 ──
    await send('请只回复一句话：第一轮')
    await expect.poll(async () => page.getByTestId('ag-msg-assistant').count(), { timeout: 90_000 }).toBe(1)
    await waitSettledLast()

    await send('请只回复一句话：第二轮')
    await expect.poll(async () => page.getByTestId('ag-msg-assistant').count(), { timeout: 90_000 }).toBe(2)
    await waitSettledLast()

    expect(await page.getByTestId('ag-msg-user').count()).toBe(2)

    // 找到本线程文件（含「第二轮」的那份），轮询终态为 4 条消息且角色交替、无重复尾巴
    const threadOf = async () => {
      for (const f of await listThreadFiles()) {
        try {
          const raw = await readFile(path.join(THREADS_DIR, f), 'utf8')
          if (raw.includes('第二轮')) return JSON.parse(raw)
        } catch { /* 忽略半写 */ }
      }
      return null
    }
    await expect
      .poll(async () => {
        const t = await threadOf()
        return t?.messages?.length ?? 0
      }, { timeout: 20_000 })
      .toBe(4)
    const thread = (await threadOf())!
    expect(thread.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])

    // ── C3：usage 存在且非 null（字段形态以 AI SDK totalUsage 为准，不锁死字段名）──
    await expect.poll(async () => (await threadOf())?.usage ?? null, { timeout: 15_000 }).toBeTruthy()

    // ── C2：刷新回放，四条消息按原序还原 ──
    await page.reload()
    const item = page.getByTestId('ag-thread-item').filter({ hasText: thread.title }).first()
    await item.click()
    await expect(page.getByTestId('ag-msg-user')).toHaveCount(2, { timeout: 15_000 })
    await expect(page.getByTestId('ag-msg-assistant')).toHaveCount(2, { timeout: 10_000 })
    await expect(page.getByTestId('ag-msg-user').nth(1)).toContainText('第二轮')

    // ── C4：空会话连点发送的防御 ──
    await newThreadReady(page)
    const emptyInput = page.getByTestId('ag-composer-input')
    await expect(emptyInput).toBeFocused()
    const sendBtn = page.getByTestId('ag-send')
    const disabled = await sendBtn.isDisabled().catch(() => false)
    if (!disabled) console.warn('[T5-C4] 空输入时发送按钮未带 disabled（观察项），以行为为准')
    await sendBtn.click({ force: true })
    await page.waitForTimeout(600)
    await expect(page.getByTestId('ag-msg-user')).toHaveCount(0) // 无空白用户气泡
    expect(await threadOf(), '未产生空白气泡污染旧线程').not.toBeNull()
  })
})
