// AI 初评客户端：调 Anthropic 兼容接口（智谱 BigModel 等）给机会做 5 维初评。
// 定位：AI 只给分数建议，用户可调整 —— 不构成承诺动作，不走确认中心（对照 ADR-0002）。
import { z } from 'zod'
import type { Scores } from '../domain/opportunity'

export interface AiScoreInput {
  title: string
  note?: string
}

/** AI 不可用（未配置/网络/解析失败）：统一映射为 503，message 可直接展示 */
export class AiError extends Error {}

export interface AiScorer {
  /** 给一个机会标题打 5 维初评；未配置或调用失败时抛错（消息可直接展示给用户） */
  score(input: AiScoreInput): Promise<Scores>
}

const SYSTEM_PROMPT = `你是一位谨慎的个人成长教练，帮用户对"机会"做 5 维速评初评。

五个维度（每维 0-20 整数）：
- value 价值度：天花板 + 复利，这事值多少、能不能积累
- feasible 可行度：普通人现有技能/资源够不够得着
- window 时间窗：窗口期长短、东风是否已到
- fit 匹配度：与个人优势/常见目标的契合度
- risk 风险度：反向计分 —— 分数越高表示下行风险越小

要求：
- 信息不足时给保守的中间值，不要极端打分
- 只输出一个 JSON 对象，不要任何解释文字，格式：
{"value": 0, "feasible": 0, "window": 0, "fit": 0, "risk": 0}`

const scoresSchema = z.object({
  value: z.number().finite(),
  feasible: z.number().finite(),
  window: z.number().finite(),
  fit: z.number().finite(),
  risk: z.number().finite(),
})

/** 模型输出裁剪到 [0,20] 整数 */
function clamp(v: number): number {
  return Math.max(0, Math.min(20, Math.round(v)))
}

export function createAiScorer(): AiScorer {
  const apiKey = process.env.WORKBENCH_AI_API_KEY
  const baseUrl = (process.env.WORKBENCH_AI_BASE_URL || 'https://open.bigmodel.cn/api/anthropic').replace(/\/+$/, '')
  const model = process.env.WORKBENCH_AI_MODEL || 'glm-5.3'

  return {
    async score(input: AiScoreInput): Promise<Scores> {
      if (!apiKey) {
        throw new AiError('AI 未配置：请在 .env 或环境变量中设置 WORKBENCH_AI_API_KEY')
      }
      const userText = [
        `机会标题：${input.title}`,
        input.note?.trim() ? `背景备注：${input.note.trim()}` : '背景备注：（无）',
        '请给出初评分数。',
      ].join('\n')

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
            max_tokens: 600,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userText }],
          }),
          signal: AbortSignal.timeout(30_000),
        })
      } catch {
        throw new AiError('AI 接口无法连接，请检查网络或 WORKBENCH_AI_BASE_URL')
      }
      if (!res.ok) {
        throw new AiError(`AI 接口返回 ${res.status}，请检查 WORKBENCH_AI_API_KEY / WORKBENCH_AI_MODEL`)
      }

      const data = (await res.json()) as { content?: { type: string; text?: string }[] }
      const text = data.content?.find((c) => c.type === 'text')?.text ?? ''
      // 从回复里抠出 JSON（模型偶尔会带 markdown 代码块）
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) {
        throw new AiError('AI 返回内容无法解析为评分')
      }
      let parsed: z.infer<typeof scoresSchema>
      try {
        parsed = scoresSchema.parse(JSON.parse(match[0]))
      } catch {
        throw new AiError('AI 返回的评分格式不合法')
      }
      return {
        value: clamp(parsed.value),
        feasible: clamp(parsed.feasible),
        window: clamp(parsed.window),
        fit: clamp(parsed.fit),
        risk: clamp(parsed.risk),
      }
    },
  }
}
