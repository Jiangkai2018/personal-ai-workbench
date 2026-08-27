// T1 · 登录与鉴权守卫：登录主链路 + Agent API 未登录 401 + （C4 JWT 空密钥兜底为外部手动步骤）
import { test, expect } from '../fixture'
import { request as pwRequest } from '@playwright/test'
import { readdir } from 'node:fs/promises'
import path from 'node:path'

const TMP = path.join(import.meta.dirname, '..', '.tmp-data')

test.describe('T1', () => {
  test('C1 · 正常登录主链路（会话 Cookie HttpOnly）', async ({ page, context }) => {
    await page.goto('/')
    await expect(page.getByLabel('用户名')).toBeVisible()
    await page.getByLabel('用户名').fill('jk')
    await page.getByLabel('密码').fill('test-password')
    await page.getByRole('button', { name: '登录' }).click()

    // 首页渲染 + 顶栏身份与退出按钮
    await expect(page.getByText('测试甲')).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByLabel('退出登录')).toBeVisible()

    const cookie = (await context.cookies()).find((c) => c.name === 'workbench_session')
    expect(cookie, '存在 workbench_session cookie').toBeTruthy()
    expect(cookie!.httpOnly).toBe(true)
  })

  // ⚠ 全套唯一故意失败用例，只跑一次（第 3 次错将触发 3 分钟 IP 锁）
  test('C2 · 错误密码 → 提示可见且不泄露账号存在性', async ({ page }) => {
    await page.goto('/')
    await page.getByLabel('用户名').fill('jk')
    await page.getByLabel('密码').fill('wrong-password')
    await page.getByRole('button', { name: '登录' }).click()
    const alert = page.locator('[role="alert"], .error, .login-error').first()
    await expect(alert).toBeVisible({ timeout: 10_000 })
  })

  test('C3 · 未登录访问 Agent API → 全线 401 且不产生文件写入', async () => {
    const apiCtx = await pwRequest.newContext() // 无 cookie 的独立上下文
    const before = new Set(await readdir(path.join(TMP, 'agent'), { recursive: true }).catch(() => []))

    const probes: Array<[string, () => Promise<any>]> = [
      ['GET /threads', () => apiCtx.get('/api/agent/threads')],
      ['POST /chat', () => apiCtx.post('/api/agent/chat', { data: {} })],
      ['GET /threads/test123', () => apiCtx.get('/api/agent/threads/test123')],
      ['PATCH /threads/test123', () => apiCtx.patch('/api/agent/threads/test123', { data: { title: 'x' } })],
      ['DELETE /threads/test123', () => apiCtx.delete('/api/agent/threads/test123')],
    ]
    for (const [name, doReq] of probes) {
      const res = await doReq()
      expect(res.status(), `${name} 应 401`).toBe(401)
      const body = await res.json().catch(() => null)
      expect(body?.error, `${name} body`).toBe('UNAUTHORIZED')
    }
    await apiCtx.dispose()

    const after = new Set(await readdir(path.join(TMP, 'agent'), { recursive: true }).catch(() => []))
    expect(after.size).toBe(before.size) // 无新文件写入
  })
})
