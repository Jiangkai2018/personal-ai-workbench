// T4 · 会话持久化与历史管理：刷新恢复、多会话切换隔离、标题派生、删除确认
import { test, expect } from '../fixture'
import { login, newThreadReady } from '../utils'
import { readdir, readFile, access, unlink } from 'node:fs/promises'
import path from 'node:path'

const THREADS_DIR = path.join(import.meta.dirname, '..', '.tmp-data', 'agent', 'threads')

async function listThreadFiles(): Promise<string[]> {
  return (await readdir(THREADS_DIR).catch(() => [] as string[])).filter((f) => f.endsWith('.json'))
}

async function readAllThreads(): Promise<any[]> {
  const out = []
  for (const f of await listThreadFiles()) {
    try {
      out.push(JSON.parse(await readFile(path.join(THREADS_DIR, f), 'utf8')))
    } catch { /* 忽略半写文件 */ }
  }
  return out
}

const exists = async (p: string) => access(p).then(() => true).catch(() => false)

const sendAndWaitSettled = async (page: import('@playwright/test').Page, text: string) => {
  const input = page.getByTestId('ag-composer-input')
  await input.fill(text)
  await input.press('Enter')
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

test.describe('T4 持久化与历史', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.describe.configure({ mode: 'serial' }) // 用例间共享文件态（自建各自的会话）

  test('C1 · 刷新页面 → 会话完整恢复', async ({ page }) => {
    test.setTimeout(240_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)
    await sendAndWaitSettled(page, '请只回复一句话：持久化探针')
    const beforeFile = (await readAllThreads()).find((t) =>
      t.messages.some((m: any) => m.role === 'user' && m.parts?.some?.((p: any) => p.text?.includes('持久化探针'))),
    )
    expect(beforeFile, '对话已落盘').toBeTruthy()

    await page.reload()
    const item = page.getByTestId('ag-thread-item').filter({ hasText: '持久化探针' }).first()
    await item.click()

    await expect(page.getByTestId('ag-msg-user').filter({ hasText: '持久化探针' })).toBeVisible({ timeout: 15_000 })
    const assistant = page.getByTestId('ag-msg-assistant')
    await expect(assistant.first()).toBeVisible({ timeout: 10_000 })
    expect((await assistant.count())).toBe(1) // 无重复气泡/残片
  })

  test('C2 · 多会话并存切换互不串扰（updated_at 倒序）', async ({ page }) => {
    test.setTimeout(300_000)
    await login(page)
    await page.goto('/agent')

    await newThreadReady(page)
    await sendAndWaitSettled(page, '请只回复一句话：甲话题')

    await newThreadReady(page)
    await sendAndWaitSettled(page, '请只回复一句话：乙话题')

    const items = page.getByTestId('ag-thread-item')
    await expect(items.filter({ hasText: '乙话题' })).toHaveCount(1)
    await expect(items.filter({ hasText: '甲话题' })).toHaveCount(1)
    const texts = await items.allInnerTexts()
    expect(texts.findIndex((s) => s.includes('乙话题'))).toBeLessThan(texts.findIndex((s) => s.includes('甲话题')))

    // 切回甲：只见甲的问答对
    await items.filter({ hasText: '甲话题' }).click()
    await expect(page.getByTestId('ag-msg-user').filter({ hasText: '甲话题' })).toBeVisible({ timeout: 15_000 })
    expect(await page.getByTestId('ag-msg-user').filter({ hasText: '乙话题' }).count()).toBe(0)
    expect(await page.getByTestId('ag-msg-assistant').count()).toBe(1)

    // 再切乙：只见乙
    await items.filter({ hasText: '乙话题' }).click()
    await expect(page.getByTestId('ag-msg-user').filter({ hasText: '乙话题' })).toBeVisible({ timeout: 15_000 })
    expect(await page.getByTestId('ag-msg-user').filter({ hasText: '甲话题' }).count()).toBe(0)
  })

  test('C3 · 标题派生：首问前缀截断落盘 + UI 同步 + 第二轮不漂移', async ({ page }) => {
    test.setTimeout(300_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    // 首问须 >24 字才能触发 slice(0,24) 截断（原文档示例仅 23 字，全保留无截断）
    const longQ = '帮我梳理一下近期财政专项债的政策风向并给出要点和风险提示' // 28 字
    await sendAndWaitSettled(page, longQ)

    const expected = longQ.slice(0, 24) // 「…政策风向并给出要点和」
    await expect
      .poll(async () => (await readAllThreads()).find((t) => t.title === expected)?.id ?? null, { timeout: 20_000 })
      .toBeTruthy()
    const threadId = (await readAllThreads()).find((t) => t.title === expected)!.id

    await expect(page.getByTestId('ag-thread-item').filter({ hasText: expected })).toBeVisible()

    // 第二轮后标题保持不变
    await sendAndWaitSettled(page, '再补充两点风险提示，只回一句话')
    const again = (await readAllThreads()).find((t) => t.id === threadId)
    expect(again.title, '第二轮后标题不变').toBe(expected)
  })

  test('C4 · 删除会话：confirm 拒绝无效 / 接受生效', async ({ page }) => {
    test.setTimeout(180_000)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)
    await sendAndWaitSettled(page, '请只回复一句话：待删会话')

    const item = () => page.getByTestId('ag-thread-item').filter({ hasText: '待删会话' })
    const fileOf = async () => {
      const t = (await readAllThreads()).find((x) => x.messages.some((m: any) => JSON.stringify(m.parts).includes('待删会话')))
      return t ? path.join(THREADS_DIR, `${t.id}.json`) : null
    }
    const file = await fileOf()
    expect(file, '目标文件存在').toBeTruthy()

    // 「删」按钮为 invisible + group-hover:visible：headless 下 hover 态不可靠，
    // 测试内直接摘掉 invisible 类（真实 click handler 与 confirm 弹窗不受影响）
    const clickDelete = async () => {
      await item().getByLabel(/^删除 /).evaluate((el) => el.classList.remove('invisible'))
      await item().getByLabel(/^删除 /).click()
    }

    // C4b：拒绝 confirm → 无删除发生
    page.once('dialog', (d) => d.dismiss())
    await clickDelete()
    await expect(item()).toHaveCount(1)
    expect(await exists(file!), 'dismiss 后文件仍在').toBe(true)

    // C4：接受 confirm → 条目消失 + 文件删除 + 中央回到空态卡（正浏览被删会话）
    page.once('dialog', (d) => d.accept())
    await clickDelete()
    await expect(item()).toHaveCount(0)
    await expect(page.getByText('开始一段新对话')).toBeVisible()
    await expect.poll(async () => exists(file!), { timeout: 10_000 }).toBe(false)
  })
})
