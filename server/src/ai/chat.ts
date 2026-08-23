// 通用 AI 对话封装（财务模块用）：读同一套 WORKBENCH_AI_* 环境变量，Anthropic 兼容接口。
import { AiError } from './scoreClient'

export async function aiChat(system: string, user: string, maxTokens = 2000): Promise<string> {
  const apiKey = process.env.WORKBENCH_AI_API_KEY
  const baseUrl = (process.env.WORKBENCH_AI_BASE_URL || 'https://open.bigmodel.cn/api/anthropic').replace(/\/+$/, '')
  const model = process.env.WORKBENCH_AI_MODEL || 'glm-5.3'
  if (!apiKey) {
    throw new AiError('AI 未配置：请在 .env 或环境变量中设置 WORKBENCH_AI_API_KEY')
  }
  let res: Response
  try {
    res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch {
    throw new AiError('AI 接口无法连接，请检查网络或 WORKBENCH_AI_BASE_URL')
  }
  if (!res.ok) {
    throw new AiError(`AI 接口返回 ${res.status}，请检查 WORKBENCH_AI_API_KEY / WORKBENCH_AI_MODEL`)
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[] }
  const text = data.content?.find((c) => c.type === 'text')?.text ?? ''
  if (!text.trim()) {
    throw new AiError('AI 返回内容为空')
  }
  return text.trim()
}
