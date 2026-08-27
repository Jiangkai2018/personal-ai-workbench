// Agent 板块单测：会话 CRUD + SSE 流式对话 + 落盘回放（全走 FAKE 模型，无外部依赖）
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { createApp } from '../src/api/app'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { seedUsers, TEST_PASSWORD } from './helpers'

/** 构造确定性 mock 模型：固定回复，分两片流式吐出 */
async function fakeModel() {
  const { MockLanguageModelV4, simulateReadableStream } = await import('ai/test')
  const reply = '你好，这里是流式回复第一段。FAKE_REPLY_MARKER 这里是第二段。'
  const chunks: LanguageModelV4StreamPart[] = [
    { type: 'text-start', id: 'a0' },
    { type: 'text-delta', id: 'a0', delta: reply.slice(0, 10) },
    { type: 'text-delta', id: 'a0', delta: reply.slice(10) },
    { type: 'text-end', id: 'a0' },
    {
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 48, text: 48, reasoning: 0 },
      },
    },
  ]
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-chat',
    doStream: async () => ({
      stream: simulateReadableStream({ initialDelayInMs: 5, chunkDelayInMs: 5, chunks }),
    }),
  })
}

/** 收集 SSE 响应为完整文本（自持缓冲，避免依赖 supertest 的 res.text） */
function readSse() {
  let raw = ''
  return {
    parse(res: IncomingMessage, cb: (err: unknown, body?: string) => void) {
      res.setEncoding('utf8')
      res.on('data', (chunk) => (raw += chunk))
      res.on('end', () => cb(null, raw))
    },
    get text(): string {
      return raw
    },
  }
}

describe('Agent —— 会话 CRUD 与流式对话', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  let cookie = ''
  const savedEnv: Array<[string, string | undefined]> = []

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-agent-'))
    await seedUsers(dataDir)
    savedEnv.push(['WORKBENCH_AGENT_FAKE', process.env.WORKBENCH_AGENT_FAKE])
    process.env.WORKBENCH_AGENT_FAKE = '1'

    const resolver = async () => fakeModel()
    app = createApp({ dataDir, agentModelResolver: resolver })

    const login = await request(app).post('/api/auth/login').send({ username: 'jk', password: TEST_PASSWORD })
    cookie = login.headers['set-cookie']?.[0] ?? ''
  })

  afterAll(async () => {
    const restore = savedEnv.pop()
    if (restore && restore[1] === undefined) delete process.env[restore[0]]
    else if (restore) process.env[restore[0]] = restore[1]
    await rm(dataDir, { recursive: true, force: true })
  })

  it('未登录访问 agent 接口 → 401', async () => {
    await request(app).get('/api/agent/threads').expect(401)
    await request(app).post('/api/agent/chat').send({}).expect(401)
  })

  it('建会话 → 发消息（SSE 流式）→ 落盘与回放', async () => {
    const created = await request(app)
      .post('/api/agent/threads')
      .set('Cookie', cookie)
      .expect(201)
    const threadId = created.body.id

    const collector = readSse()
    const res = await request(app)
      .post('/api/agent/chat')
      .set('Cookie', cookie)
      .send({
        id: threadId,
        messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: '请做一份示范对话' }] }],
      })
      .buffer(true)
      .parse(collector.parse)

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')
    const sseText = collector.text
    // 分片事件到达前端 + 可见回复完整送达
    expect(sseText).toContain('"type":"text-delta"')
    expect(sseText.includes('FAKE_REPLY_MARKER')).toBe(true)

    // 服务端已把完整消息流落盘，回放可得
    const full = await request(app).get(`/api/agent/threads/${threadId}`).set('Cookie', cookie).expect(200)
    const thread = full.body as { title: string; messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> }
    expect(thread.messages).toHaveLength(2)
    expect(thread.title).toBe('请做一份示范对话')
    const assistantText = thread.messages[1].parts.filter((p) => p.type === 'text').map((p) => p.text ?? '').join('')
    expect(assistantText).toContain('第二段')
  })

  it('多轮：第二轮携带历史重发后，落盘共 4 条消息', async () => {
    const created = await request(app).post('/api/agent/threads').set('Cookie', cookie).expect(201)
    const id = created.body.id

    const postChat = (messages: unknown[]) =>
      request(app)
        .post('/api/agent/chat')
        .set('Cookie', cookie)
        .send({ id, messages })
        .buffer(true)
        .parse(readSse().parse)

    const r1 = await postChat([{ id: 'mu1', role: 'user', parts: [{ type: 'text', text: '第一轮' }] }])
    expect(r1.status).toBe(200)

    const full1 = await request(app).get(`/api/agent/threads/${id}`).set('Cookie', cookie).expect(200)
    const history = full1.body.messages as unknown[]

    const r2 = await postChat([...history, { id: 'mu2', role: 'user', parts: [{ type: 'text', text: '第二轮' }] }])
    expect(r2.status).toBe(200)

    const full2 = await request(app).get(`/api/agent/threads/${id}`).set('Cookie', cookie).expect(200)
    expect(full2.body.messages).toHaveLength(4)

    // 标题取首轮用户提问
    expect(full2.body.title).toBe('第一轮')

    // 重命名 + 删除闭环
    await request(app)
      .patch(`/api/agent/threads/${id}`)
      .set('Cookie', cookie)
      .send({ title: '我的政策研究' })
      .expect(200)
    const listAfterRename = await request(app).get('/api/agent/threads').set('Cookie', cookie).expect(200)
    const renamed = (listAfterRename.body as Array<{ id: string; title: string }>).find((t) => t.id === id)
    expect(renamed?.title).toBe('我的政策研究')

    await request(app).delete(`/api/agent/threads/${id}`).set('Cookie', cookie).expect(200)
    await request(app).get(`/api/agent/threads/${id}`).set('Cookie', cookie).expect(404)
  })
})
