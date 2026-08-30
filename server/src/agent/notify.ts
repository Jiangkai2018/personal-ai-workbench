// 钉钉群自定义机器人推送（0828-01 §3.3/§3.4）：加签（timestamp + HMAC-SHA256）+ markdown 消息 + 指数退避重试
// secret 属敏感信息：只在拼接签名 URL 时使用，不打日志、不回传前端。
import { createHmac } from 'node:crypto'

export interface DingtalkConfig {
  enabled: boolean
  webhook?: string
  secret?: string
  baseUrl?: string
}

/** 加签 URL：webhook + &timestamp=…&sign=urlencode(base64(hmac_sha256(`${ts}\n${secret}`, secret))) */
export function buildDingtalkSignedUrl(webhook: string, secret: string, timestamp: number): string {
  const sign = createHmac('sha256', secret).update(`${timestamp}\n${secret}`).digest('base64')
  const sep = webhook.includes('?') ? '&' : '?'
  return `${webhook}${sep}timestamp=${timestamp}&sign=${encodeURIComponent(sign)}`
}

/** 毫秒 → 「Xm Ys」 */
function humanDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`
}

/** 摘要截 200 字（§3.4） */
function clip(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return [...clean].length > max ? [...clean].slice(0, max).join('') + '…' : clean
}

export interface CompletionMessageInput {
  title: string
  durationMs: number
  model: string
  summary: string
  threadId: string
  baseUrl?: string
  failed?: boolean
  error?: string
}

/** 完成推送 markdown 正文；baseUrl 未配置则深链整行省略（决策 #11） */
export function buildCompletionMessage(input: CompletionMessageInput): string {
  const head = input.failed ? '### ❌ 运行失败' : '### ✅ 已完成'
  const lines = [
    `${head}：${input.title}`,
    `> 耗时 ${humanDuration(input.durationMs)} ｜ 模型 ${input.model}`,
    '',
  ]
  if (input.failed && input.error) lines.push(`错误：${clip(input.error, 200)}`, '')
  else if (input.summary) lines.push(clip(input.summary), '')
  if (input.baseUrl) {
    lines.push(`[打开完整会话](${input.baseUrl.replace(/\/+$/, '')}/agent?thread=${encodeURIComponent(input.threadId)})`)
  }
  return lines.join('\n')
}

export interface SendOptions {
  retries?: number
  baseDelayMs?: number
}

/** 发送 markdown 消息；网络/业务失败按指数退避重试，仍败返回 ok=false（绝不抛错、不阻塞调用方） */
export async function sendDingtalk(config: DingtalkConfig, markdown: string, opts: SendOptions = {}): Promise<{ ok: boolean; error?: string }> {
  if (!config.enabled || !config.webhook) return { ok: false, error: '未启用或未配置 webhook' }
  const retries = opts.retries ?? 2
  const baseDelay = opts.baseDelayMs ?? 500
  const url = config.secret
    ? buildDingtalkSignedUrl(config.webhook, config.secret, Date.now())
    : config.webhook

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msgtype: 'markdown', markdown: { title: '工作台通知', text: markdown } }),
        signal: AbortSignal.timeout(10_000),
      })
      const body = (await res.json().catch(() => ({}))) as { errcode?: number; errmsg?: string }
      if (res.ok && body.errcode === 0) return { ok: true }
      if (attempt === retries) return { ok: false, error: `钉钉返回 errcode=${body.errcode ?? res.status}` }
    } catch (err) {
      if (attempt === retries) return { ok: false, error: (err as Error).message }
    }
    await new Promise((r) => setTimeout(r, baseDelay * 2 ** attempt))
  }
  return { ok: false, error: 'unreachable' }
}
