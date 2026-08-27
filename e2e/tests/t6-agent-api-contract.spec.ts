// T6 · API 契约直验：threads CRUD / chat SSE 流协议 / 入参校验拒绝面 / models 打码
// 契约层用例不走 UI：登录拿 cookie 后全部走 page.request
import { test, expect } from '../fixture'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const TMP = path.join(import.meta.dirname, '..', '.tmp-data')

async function loginApi(page: import('@playwright/test').Page) {
  const res = await page.context().request.post('/api/auth/login', {
    data: { username: 'jk', password: 'test-password' },
  })
  expect(res.status()).toBe(200)
}

test.describe('T6 API 契约', () => {
  test('C1 · 会话 CRUD 契约（含幂等建号与元信息瘦身）', async ({ page }) => {
    test.setTimeout(60_000)
    await loginApi(page)
    const req = page.context().request

    // 1) 裸建 → 201 完整字段
    const r1 = await req.post('/api/agent/threads', { data: {} })
    expect(r1.status()).toBe(201)
    const t1 = await r1.json()
    expect(t1.id).toMatch(/^[\w-]+$/)
    expect(t1.title).toBe('新对话')
    expect(t1.messages).toEqual([])
    expect(t1.created_at).toBeTruthy()

    // 2) 幂等 id：先删后建两次同 id；重复 POST 不覆盖既有内容
    await req.delete('/api/agent/threads/t-e2e-api1')
    const r2a = await req.post('/api/agent/threads', { data: { id: 't-e2e-api1' } })
    expect(r2a.status()).toBe(201)
    expect((await r2a.json()).id).toBe('t-e2e-api1')
    // 改名造差异后再次同 id POST → 不应重置为新对话
    expect((await req.patch('/api/agent/threads/t-e2e-api1', { data: { title: '契约改名' } })).status()).toBe(200)
    const r2b = await req.post('/api/agent/threads', { data: { id: 't-e2e-api1' } })
    expect(r2b.status()).toBe(201)
    expect((await r2b.json()).title, '幂等 POST 保留既有内容').toBe('契约改名')

    // 3) 列表元信息瘦身：不含 messages 字段
    const listRes = await req.get('/api/agent/threads')
    expect(listRes.status()).toBe(200)
    const list = await listRes.json()
    expect(Array.isArray(list)).toBe(true)
    expect(list.length).toBeGreaterThanOrEqual(1)
    for (const meta of list) {
      expect(meta).not.toHaveProperty('messages')
      expect(meta.id).toBeTruthy()
    }

    // 4) PATCH 生效复查已隐含于步骤 2b；（4b）GET 单体确认 title
    const got = await (await req.get('/api/agent/threads/t-e2e-api1')).json()
    expect(got.title).toBe('契约改名')

    // 5) 空/超长标题 → 400 INVALID_INPUT + zod issues
    for (const bad of ['', 'x'.repeat(61)]) {
      const res = await req.patch('/api/agent/threads/t-e2e-api1', { data: { title: bad } })
      expect(res.status(), `标题长度 ${bad.length}`).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('INVALID_INPUT')
      expect(body.issues?.length).toBeGreaterThan(0)
    }

    // 6) DELETE → 200；GET → 404；再 DELETE → 404
    expect((await req.delete('/api/agent/threads/t-e2e-api1')).status()).toBe(200)
    expect((await req.get('/api/agent/threads/t-e2e-api1')).status()).toBe(404)
    expect((await req.delete('/api/agent/threads/t-e2e-api1')).status()).toBe(404)

    await req.delete(`/api/agent/threads/${t1.id}`) // 清场
  })

  test('C2 · chat SSE 流协议契约 + 落盘终态一致性', async ({ page }) => {
    test.setTimeout(180_000)
    await loginApi(page)
    const req = page.context().request

    const payload = {
      id: 't-e2e-sse',
      messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '请只回复一句话：契约探针' }] }],
    }
    const res = await req.post('/api/agent/chat', { data: payload })
    expect(res.headers()['content-type']).toContain('text/event-stream')
    const raw = await res.text()

    expect(raw).toContain('"type":"start"')
    expect(raw).toContain('"type":"finish"')
    // 收集 text-delta 与 usage
    let deltas = ''
    let finishHasUsage = false
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data:')) continue
      try {
        const evt = JSON.parse(line.slice(5))
        if (evt.type === 'text-delta') deltas += evt.delta ?? ''
        if (evt.type === 'finish' && evt.totalUsage) finishHasUsage = true
      } catch { /* SSE 心跳行容忍 */ }
    }
    expect(deltas.trim().length, 'delta 拼接非空').toBeGreaterThan(0)

    // 落盘终态：messages=2、assistant 文本非空且与 delta 拼接一致、存在 usage
    const thread = await (await req.get('/api/agent/threads/t-e2e-sse')).json()
    expect(thread.messages).toHaveLength(2)
    expect(thread.usage).toBeTruthy()
    const assistantText =
      thread.messages[1].parts.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('') ?? ''
    expect(assistantText.trim()).toBe(deltas.trim())
  })

  test('C3 · 入参校验拒绝面（含路径穿越不泄配置）', async ({ page }) => {
    test.setTimeout(60_000)
    await loginApi(page)
    const req = page.context().request

    const msg = (role = 'user') => [{ id: 'u1', role, parts: [{ type: 'text', text: 'x' }] }]
    const badBodies: Array<[string, unknown]> = [
      ['缺 messages', { id: 't-e2e-bad' }],
      ['空 messages', { id: 't-e2e-bad', messages: [] }],
      ['id 含斜杠穿越', { id: '../escape', messages: msg() }],
      ['id 含空格', { id: 'a b', messages: msg() }],
      ['非法 role', { id: 't-e2e-bad', messages: msg('hacker' as never) }],
    ]
    for (const [name, body] of badBodies) {
      const res = await req.post('/api/agent/chat', { data: body })
      expect(res.status(), name).toBe(400)
      expect(((await res.json()) as any).error).toBe('INVALID_INPUT')
    }
    // 白名单外 id 未写任何文件
    expect(await readFile(path.join(TMP, 'agent', 'threads', '..%2fescape.json'), 'utf8').catch(() => null)).toBeNull()

    // GET 路径穿越：不得返回配置文件内容
    const res = await req.get('/api/agent/threads/../..%2fconfig%2fai-providers')
    expect([400, 404]).toContain(res.status())
    const text = await res.text()
    expect(text, '响应不含密钥形态字符串').not.toContain('sk-test-')
    expect(text).not.toContain('apiKey')
  })

  test('C4 · models 打码端点（尾四位 + 只读不回写）', async ({ page }) => {
    test.setTimeout(60_000)
    await loginApi(page)
    const req = page.context().request

    // 无配置文件 → 空清单兜底
    await rm(path.join(TMP, 'config'), { recursive: true, force: true })
    const empty = await (await req.get('/api/agent/models')).json()
    expect(empty).toEqual({ providers: [], defaultModel: null })

    // 写入最小厂商配置 → 打码返回，原文件不被改写
    await mkdir(path.join(TMP, 'config'), { recursive: true })
    const cfgPath = path.join(TMP, 'config', 'ai-providers.json')
    await writeFile(
      cfgPath,
      JSON.stringify({
        providers: [
          {
            id: 'p1',
            label: '测试厂商',
            kind: 'openai-compatible',
            baseURL: 'http://localhost:9/v1',
            apiKey: 'sk-test-abcd1234',
          },
        ],
        defaultModel: { providerId: 'p1', model: 'glm-air' },
      }),
      'utf8',
    )
    const masked = await (await req.get('/api/agent/models')).json()
    expect(masked.providers).toHaveLength(1)
    expect(masked.providers[0].apiKey).toBe('***1234')
    expect(masked.defaultModel).toEqual({ providerId: 'p1', model: 'glm-air' })

    const rawOnDisk = JSON.parse(await readFile(cfgPath, 'utf8'))
    expect(rawOnDisk.providers[0].apiKey, '打码值未回写文件').toBe('sk-test-abcd1234')

    await rm(path.join(TMP, 'config'), { recursive: true, force: true }) // 清理
  })
})
