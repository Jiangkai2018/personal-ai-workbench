// 钉钉群机器人推送单测（0828-01 §3.3/§3.4）：加签算法（固定向量）+ 消息构造 + 重试（stub fetch）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCompletionMessage, buildDingtalkSignedUrl, sendDingtalk, type DingtalkConfig } from './notify'

describe('钉钉加签', () => {
  it('timestamp+HMAC-SHA256(secret) 拼接，URL 编码（RFC 固定向量）', () => {
    const url = buildDingtalkSignedUrl('https://oapi.dingtalk.com/robot/send?access_token=abc', 'SEC-test-secret', 1700000000000)
    expect(url).toBe(
      'https://oapi.dingtalk.com/robot/send?access_token=abc&timestamp=1700000000000&sign=Mrhy389nC5p7fqYHgciQpNWFiBNjbTx4Rn5BqEH45jY%3D',
    )
  })
})

describe('消息构造', () => {
  it('完成消息：标题/耗时/模型/摘要 200 字/深链（baseUrl 未配置整行省略）', () => {
    const md = buildCompletionMessage({
      title: '政策调研',
      durationMs: 392_000,
      model: 'glm-5.3',
      summary: '调研结论如下'.repeat(80), // 480 字 → 截 200
      threadId: 't-1',
      baseUrl: 'https://wb.example.com',
      failed: false,
    })
    expect(md).toContain('### ✅ 已完成：政策调研')
    expect(md).toContain('耗时 6m32s')
    expect(md).toContain('模型 glm-5.3')
    expect(md).toContain('[打开完整会话](https://wb.example.com/agent?thread=t-1)')
    const summaryLine = md.split('\n').find((l) => l.startsWith('调研结论'))
    expect([...(summaryLine ?? '')].length).toBeLessThanOrEqual(201) // 200 字 + 截断号

    const noLink = buildCompletionMessage({ title: 't', durationMs: 1000, model: 'm', summary: 's', threadId: 'x' })
    expect(noLink).not.toContain('打开完整会话')
  })

  it('失败消息：❌ 状态行 + 错误信息', () => {
    const md = buildCompletionMessage({ title: 't', durationMs: 2000, model: 'm', summary: '', threadId: 'x', failed: true, error: '模型超时' })
    expect(md).toContain('❌ 运行失败')
    expect(md).toContain('模型超时')
  })
})

describe('发送与重试', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const config: DingtalkConfig = {
    enabled: true,
    webhook: 'https://oapi.dingtalk.com/robot/send?access_token=abc',
    secret: 'SEC-test-secret',
  }

  async function okRes() {
    return new Response(JSON.stringify({ errcode: 0, errmsg: 'ok' }), { status: 200 })
  }

  it('成功：POST markdown 消息到加签 URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okRes())
    vi.stubGlobal('fetch', fetchMock)
    const r = await sendDingtalk(config, '### 测试', { retries: 2, baseDelayMs: 1 })
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('timestamp=')
    expect(url).toContain('sign=')
    const body = JSON.parse(String(init.body))
    expect(body.msgtype).toBe('markdown')
    expect(body.markdown.text).toBe('### 测试')
  })

  it('网络失败重试 2 次指数退避，仍败则返回 ok=false（不抛错）', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await sendDingtalk(config, '### 测试', { retries: 2, baseDelayMs: 1 })
    expect(r.ok).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('钉钉业务错误（errcode!=0）也按失败计并重试', async () => {
    let n = 0
    const fetchMock = vi.fn().mockImplementation(async () => {
      n++
      return n >= 3
        ? okRes()
        : new Response(JSON.stringify({ errcode: 130101, errmsg: 'words is empty' }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const r = await sendDingtalk(config, '### 测试', { retries: 2, baseDelayMs: 1 })
    expect(r.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('enabled=false 或缺 webhook → 不发请求直接跳过', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const r1 = await sendDingtalk({ ...config, enabled: false }, 'x', { retries: 2, baseDelayMs: 1 })
    const r2 = await sendDingtalk({ enabled: true, webhook: '', secret: 's' }, 'x', { retries: 2, baseDelayMs: 1 })
    expect(r1.ok).toBe(false)
    expect(r2.ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
