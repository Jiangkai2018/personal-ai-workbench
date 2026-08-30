// 会话即长任务集成测试（0828-01 §3 / ADR-0008）：
// 开关开启 → 客户端断连不中止 → 落盘 → 收到钉钉推送；手动停止 → 不推送；
// 会话互斥 409；未开开关断连即中止（现状语义）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import request from 'supertest'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { createApp } from '../src/api/app'
import { seedUsers, TEST_PASSWORD } from './helpers'

/** 慢速确定性 mock 模型：~1.2s 流完，够断连/停止操作落进来 */
async function slowFakeModel() {
  const { MockLanguageModelV4, simulateReadableStream } = await import('ai/test')
  const reply = '慢速模型的第一段。SLOW_REPLY_MARKER 第二段。第三段收尾。'
  const chunks: LanguageModelV4StreamPart[] = [
    { type: 'text-start', id: 'a0' },
    ...reply.match(/.{1,4}/gu)!.map((delta) => ({ type: 'text-delta', id: 'a0', delta }) as LanguageModelV4StreamPart),
    { type: 'text-end', id: 'a0' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 40, text: 40, reasoning: 0 } },
    },
  ]
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'slow-chat',
    doStream: async () => ({ stream: simulateReadableStream({ initialDelayInMs: 200, chunkDelayInMs: 80, chunks }) }),
  }) as never
}

interface WebhookRec { path: string; body: { msgtype: string; markdown: { title: string; text: string } } }

async function startMockWebhook(): Promise<{ server: http.Server; port: number; calls: WebhookRec[] }> {
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

function waitFor(fn: () => boolean | Promise<boolean>, timeoutMs = 8000, intervalMs = 50): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = async () => {
      let ok: boolean
      try {
        ok = await fn()
      } catch {
        ok = false
      }
      if (ok) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('waitFor 超时'))
      setTimeout(tick, intervalMs)
    }
    void tick()
  })
}

describe('断连续跑 + 钉钉推送', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  let server: http.Server
  let port: number
  let cookie = ''
  let webhook: { server: http.Server; port: number; calls: WebhookRec[] }

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-cont-'))
    await seedUsers(dataDir)
    webhook = await startMockWebhook()
    await mkdir(path.join(dataDir, 'config'), { recursive: true })
    await writeFile(
      path.join(dataDir, 'config', 'ai-providers.json'),
      JSON.stringify({
        providers: [],
        defaultModel: { providerId: 'x', model: 'y' },
        notify: { dingtalk: { enabled: true, webhook: `http://127.0.0.1:${webhook.port}/robot/send`, secret: 'SEC-test-secret' } },
      }),
      'utf8',
    )
    app = createApp({ dataDir, jwtSecret: 'test-secret', agentModelResolver: slowFakeModel })
    await new Promise<void>((r) => {
      server = app.listen(0, '127.0.0.1', () => r())
    })
    port = (server.address() as AddressInfo).port
    const login = await request(app).post('/api/auth/login').send({ username: 'jk', password: TEST_PASSWORD })
    cookie = (login.headers['set-cookie']?.[0] ?? '').split(';')[0]
  })

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()))
    await new Promise<void>((r) => webhook.server.close(() => r()))
    await rm(dataDir, { recursive: true, force: true })
  })

  /** 裸 http 发 /chat，收到第一块 SSE 即断连（模拟关页/断网） */
  function postChatAndDisconnect(threadId: string, text = '后台跑一个长任务') {
    return new Promise<void>((resolve) => {
      const payload = JSON.stringify({
        id: threadId,
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }],
      })
      const req = http.request(
        { host: '127.0.0.1', port, path: '/api/agent/chat', method: 'POST', headers: { 'content-type': 'application/json', cookie } },
        (res) => {
          res.on('data', () => {
            req.destroy()
            resolve()
          })
        },
      )
      req.on('error', () => resolve())
      req.end(payload)
    })
  }

  /** 裸 http 发 /chat 并保持连接（返回完成信号），解决 supertest 懒启动导致的状态竞态 */
  function postChatKeepAlive(threadId: string, text: string): { done: Promise<void> } {
    let done!: () => void
    const finished = new Promise<void>((r) => (done = r))
    const payload = JSON.stringify({
      id: threadId,
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text }] }],
    })
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/agent/chat', method: 'POST', headers: { 'content-type': 'application/json', cookie } },
      (res) => {
        res.resume()
        res.on('end', () => done())
      },
    )
    req.on('error', () => done())
    req.end(payload)
    return { done: finished }
  }

  function status(threadId: string) {
    return request(app).get(`/api/agent/threads/${threadId}/status`).set('Cookie', cookie)
  }

  it('开关开启：断连 → 续跑 → 落盘 → 推送到 mock webhook（无 baseUrl 无深链）', async () => {
    const created = await request(app).post('/api/agent/threads').set('Cookie', cookie).expect(201)
    const id = created.body.id
    await request(app).patch(`/api/agent/threads/${id}`).set('Cookie', cookie).send({ pushOnCompletion: true }).expect(200)

    await postChatAndDisconnect(id)
    // 断连后仍在跑
    await waitFor(async () => (await status(id)).body.running === true, 3000)
    // 跑完落盘
    await waitFor(async () => (await status(id)).body.running === false, 10000)
    const full = await request(app).get(`/api/agent/threads/${id}`).set('Cookie', cookie).expect(200)
    expect(full.body.messages).toHaveLength(2)
    const reply = (full.body.messages[1].parts as Array<{ type: string; text?: string }>).map((p) => p.text ?? '').join('')
    expect(reply).toContain('SLOW_REPLY_MARKER')

    // 推送到达：加签 + ✅ + 标题，无 baseUrl → 无深链
    await waitFor(() => webhook.calls.length >= 1, 5000)
    const call = webhook.calls[0]
    expect(call.path).toContain('timestamp=')
    expect(call.path).toContain('sign=')
    expect(call.body.markdown.text).toContain('✅ 已完成')
    expect(call.body.markdown.text).toContain('后台跑一个长任务')
    expect(call.body.markdown.text).not.toContain('打开完整会话')
  })

  it('手动停止：不推送，状态回到未运行', async () => {
    webhook.calls.length = 0
    const created = await request(app).post('/api/agent/threads').set('Cookie', cookie).expect(201)
    const id = created.body.id
    await request(app).patch(`/api/agent/threads/${id}`).set('Cookie', cookie).send({ pushOnCompletion: true })

    const { done } = postChatKeepAlive(id, '会被停止的任务')
    await waitFor(
      async () => {
        const s = await status(id)
        process.stdout.write(`[dbg-test] poll id=${id} body=${JSON.stringify(s.body)} t=${Date.now() % 100000}\n`)
        return s.body.running === true
      },
      3000,
    )
    const stopRes = await request(app).post(`/api/agent/threads/${id}/stop`).set('Cookie', cookie)
    process.stdout.write(`[dbg-test] stop status=${stopRes.status} body=${JSON.stringify(stopRes.body)} t=${Date.now() % 100000}\n`)
    expect(stopRes.status).toBe(200)
    await Promise.race([done, new Promise((r) => setTimeout(r, 5000))])
    await waitFor(async () => (await status(id)).body.running === false, 5000)
    await new Promise((r) => setTimeout(r, 300)) // 给误推送留观察窗
    expect(webhook.calls).toHaveLength(0)
  })

  it('会话互斥：运行中再发消息 → 409', async () => {
    const created = await request(app).post('/api/agent/threads').set('Cookie', cookie).expect(201)
    const id = created.body.id
    const { done } = postChatKeepAlive(id, '占用中的任务')
    await waitFor(async () => (await status(id)).body.running === true, 3000)
    const second = await request(app)
      .post('/api/agent/chat')
      .set('Cookie', cookie)
      .send({ id, messages: [{ id: 'm2', role: 'user', parts: [{ type: 'text', text: '插队' }] }] })
      .expect(409)
    expect(second.body.error).toBe('RUNNING')
    await Promise.race([done, new Promise((r) => setTimeout(r, 5000))])
  })

  it('未开开关：断连即中止（现状语义），不推送', async () => {
    webhook.calls.length = 0
    const created = await request(app).post('/api/agent/threads').set('Cookie', cookie).expect(201)
    const id = created.body.id
    await postChatAndDisconnect(id)
    await waitFor(async () => (await status(id)).body.running === false, 5000)
    // 没落盘（中止）且没推送
    await new Promise((r) => setTimeout(r, 500))
    const full = await request(app).get(`/api/agent/threads/${id}`).set('Cookie', cookie).expect(200)
    expect(full.body.messages).toHaveLength(0)
    expect(webhook.calls).toHaveLength(0)
  })

  it('status 端点对未知会话返回 not-running', async () => {
    const res = await request(app).get('/api/agent/threads/nonexistent-id/status').set('Cookie', cookie).expect(200)
    expect(res.body.running).toBe(false)
  })
})
