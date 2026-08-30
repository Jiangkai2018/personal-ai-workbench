// T13 · 会话即长任务 e2e（0828-01 §3 / ADR-0008）：
// 开关未配置置灰 → 配置后开启 → 断连（关页）续跑→落盘→mock webhook 收到推送 → 深链重开可见；手动停止不推
// 模型走 fake provider（确定性、~300ms 流完），推送打到本测试起的 mock webhook。
import http from 'node:http'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { test, expect } from '../fixture'
import { login, newThreadReady } from '../utils'

const SHOT_DIR = path.resolve(import.meta.dirname, '../../local_docs/01.迭代任务/0828-01/docs/e2e/01.验证结果截图')
const CONFIG = path.join(import.meta.dirname, '../.tmp-data/config/ai-providers.json')

interface WebhookRec {
  path: string
  body: { msgtype: string; markdown: { title: string; text: string } }
}

async function startMockWebhook() {
  const calls: WebhookRec[] = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      calls.push({ path: req.url ?? '', body: JSON.parse(raw || '{}') })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ errcode: 0, errmsg: 'ok' }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { server, port: (server.address() as AddressInfo).port, calls }
}

async function writeAgentConfig(webhookUrl: string) {
  await mkdir(path.dirname(CONFIG), { recursive: true })
  await writeFile(
    CONFIG,
    JSON.stringify({
      providers: [{ id: 'fake', label: 'FAKE', kind: 'fake' }],
      defaultModel: { providerId: 'fake', model: 'fake-chat' },
      notify: { dingtalk: { enabled: true, webhook: webhookUrl, secret: 'SEC-e2e-secret' } },
    }),
    'utf8',
  )
}

async function removeConfig() {
  await rm(CONFIG, { force: true })
}

test.describe('T13 推送与断连续跑', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  let webhook: { server: http.Server; port: number; calls: WebhookRec[] }

  test.beforeAll(async () => {
    webhook = await startMockWebhook()
  })
  test.afterAll(async () => {
    await new Promise<void>((r) => webhook.server.close(() => r()))
    await removeConfig() // 不影响后续/重跑的其它用例语义
  })

  test('C1 · 未配置钉钉：推送开关置灰并提示', async ({ page }) => {
    await removeConfig()
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    const toggle = page.getByTestId('ag-push-toggle')
    await expect(toggle).toBeDisabled()
    await expect(page.getByTestId('ag-push-bar')).toContainText('未配置')
  })

  test('C2 · 开启开关：关页断连 → 续跑落盘 → mock webhook 收到推送 → 深链重开', async ({ page }) => {
    await writeAgentConfig(`http://127.0.0.1:${webhook.port}/robot/send`)
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    // 开关可用且可勾选
    const toggle = page.getByTestId('ag-push-toggle')
    await expect(toggle).toBeEnabled()
    await toggle.check()

    // 记录会话 id（推送条里展示）
    const threadId = (await page.getByTestId('ag-push-bar').locator('span').first().textContent())?.trim() ?? ''

    // 发送后立刻关页（模拟关页/断网）；fake 模型 ~300ms 流完，服务端应续跑完并推送
    await page.getByTestId('ag-composer-input').fill('后台跑一个任务吧')
    await page.getByTestId('ag-send').click()
    await page.waitForTimeout(600) // 请求已到服务端、流仍在跑（初始延迟 1.5s）
    await page.close()
    expect(threadId).not.toBe('')

    // mock webhook 收到推送：加签 + ✅
    await expect
      .poll(() => webhook.calls.length, { timeout: 15_000, intervals: [250, 500, 1_000] })
      .toBeGreaterThan(0)
    const call = webhook.calls[0]
    expect(call.path).toContain('timestamp=')
    expect(call.path).toContain('sign=')
    expect(call.body.markdown.text).toContain('✅ 已完成')

    // 深链重开（新页面）：会话内容已落盘可回放
    const { mkdir } = await import('node:fs/promises')
    await mkdir(SHOT_DIR, { recursive: true })
    const page2 = await page.context().newPage()
    await page2.goto(`/agent?thread=${threadId}`)
    await expect(page2.getByTestId('ag-composer-input')).toBeFocused({ timeout: 15_000 })
    await expect(page2.getByText('这是 FAKE 模式的确定性回复').first()).toBeVisible({ timeout: 10_000 })
    await page2.waitForTimeout(300)
    await page2.screenshot({ path: path.join(SHOT_DIR, 'F-21-断连续跑-深链回放.png') })
    await page2.close()
  })

  test('C3 · 手动停止：不推送', async ({ page }) => {
    webhook.calls.length = 0
    await login(page)
    await page.goto('/agent')
    await newThreadReady(page)

    await page.getByTestId('ag-push-toggle').check()
    await page.getByTestId('ag-composer-input').fill('这个任务会被手动停止')
    await page.getByTestId('ag-send').click()

    // 运行中立刻点「停止」（走 stop 端点，打标 manual-stop）
    const stop = page.getByTestId('ag-stop')
    await expect(stop).toBeVisible({ timeout: 5_000 })
    await stop.click()

    // 留观察窗：不应有任何推送
    await page.waitForTimeout(2_500)
    expect(webhook.calls, '手动停止不应触发推送').toHaveLength(0)
  })
})
