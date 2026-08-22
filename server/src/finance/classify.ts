// 账单分类：规则表优先（支付宝官方分类 ≈ 随手记镜像分类），未命中走 AI 批量兜底。
// AI 只选分类不改数字；不可用时用安全默认分类，导入流程不中断。
import { z } from 'zod'
import { AiError } from '../ai/scoreClient'
import {
  aiCategoryOptions,
  fallbackCategory,
  findCategory,
  ruleLookup,
  wechatFormDefault,
  type SsjCategory,
} from './categoryMap'
import type { BillRow } from './types'

export interface Classified {
  categoryId: string
  categoryName: string
  classifiedBy: 'rule' | 'ai' | 'fallback'
}

/** 规则层：一行一个判定，返回 null 表示需要 AI */
function ruleClassify(row: BillRow): SsjCategory | null {
  if (row.source === 'alipay') {
    return ruleLookup(row.categorySource, row.type)
  }
  // 微信：转账/红包有规则；商户消费/扫码 → 表单式默认分类（AI 可升级，但量大时全走 AI 太慢太贵，
  // 折中：扫码/商户消费中 counterparty 含明确品类关键词的少数场景交给 AI，其余用表单式默认）
  return ruleLookup(row.categorySource, row.type) ?? wechatFormDefault(row.categorySource)
}

const aiResponseSchema = z.object({
  results: z.array(z.object({ index: z.number().int(), category: z.string().min(1) })),
})

/** AI 批量分类：一次调用处理整批未命中行 */
async function aiClassify(rows: BillRow[]): Promise<Map<number, SsjCategory>> {
  const apiKey = process.env.WORKBENCH_AI_API_KEY
  const baseUrl = (process.env.WORKBENCH_AI_BASE_URL || 'https://open.bigmodel.cn/api/anthropic').replace(/\/+$/, '')
  const model = process.env.WORKBENCH_AI_MODEL || 'glm-5.3'
  if (!apiKey) throw new AiError('AI 未配置：请在 .env 或环境变量中设置 WORKBENCH_AI_API_KEY')

  // 收支分开问（分类清单不同）；这里简化为按第一行类型整批处理（预览行通常混合，分两次调用）
  const groups = new Map<'income' | 'expense', number[]>()
  rows.forEach((r, i) => {
    const arr = groups.get(r.type) ?? []
    arr.push(i)
    groups.set(r.type, arr)
  })

  const out = new Map<number, SsjCategory>()
  for (const [type, indexes] of groups) {
    const lines = indexes.map(
      (i, n) => `${n}. 分类字段:${rows[i].categorySource} | 对方:${rows[i].counterparty.slice(0, 30)} | 商品:${rows[i].detail.slice(0, 50)}`,
    )
    const options = aiCategoryOptions(type).join('、')
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: `你是记账分类助手。从给定分类清单中为每笔消费选出最合适的一个（格式必须是"一级>二级"）。\n清单：${options}\n只输出 JSON：{"results":[{"index":0,"category":"一级>二级"}]}`,
        messages: [{ role: 'user', content: lines.join('\n') }],
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) throw new AiError(`AI 接口返回 ${res.status}`)
    const data = (await res.json()) as { content?: { type: string; text?: string }[] }
    const text = data.content?.find((c) => c.type === 'text')?.text ?? ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) throw new AiError('AI 返回内容无法解析')
    const parsed = aiResponseSchema.parse(JSON.parse(match[0]))
    for (const item of parsed.results) {
      const rowIdx = indexes[item.index]
      if (rowIdx === undefined) continue
      const cat = findCategory(item.category, type)
      if (cat) out.set(rowIdx, cat)
    }
  }
  return out
}

export interface ClassifyResult {
  rows: (Classified & { row: BillRow })[]
  aiUsed: boolean
  aiError?: string
}

/** 整批分类入口：规则优先 → 未命中的批量 AI → 再未命中/失败用兜底 */
export async function classifyRows(rows: BillRow[]): Promise<ClassifyResult> {
  const out: (Classified & { row: BillRow })[] = []
  const needAi: number[] = []

  rows.forEach((row, i) => {
    const hit = ruleClassify(row)
    if (hit) {
      out[i] = { row, categoryId: hit.id, categoryName: hit.name, classifiedBy: 'rule' }
    } else {
      needAi.push(i)
    }
  })

  let aiUsed = false
  let aiError: string | undefined
  if (needAi.length > 0) {
    try {
      const aiMap = await aiClassify(needAi.map((i) => rows[i]))
      const globalMap = new Map<number, SsjCategory>()
      needAi.forEach((rowIdx, n) => {
        const hit = aiMap.get(n)
        if (hit) globalMap.set(rowIdx, hit)
      })
      for (const i of needAi) {
        const hit = globalMap.get(i)
        if (hit) {
          out[i] = { row: rows[i], categoryId: hit.id, categoryName: hit.name, classifiedBy: 'ai' }
          aiUsed = true
        } else {
          const fb = fallbackCategory(rows[i].type)
          out[i] = { row: rows[i], categoryId: fb.id, categoryName: fb.name, classifiedBy: 'fallback' }
        }
      }
    } catch (err) {
      aiError = err instanceof AiError ? err.message : 'AI 分类失败'
      for (const i of needAi) {
        const fb = fallbackCategory(rows[i].type)
        out[i] = { row: rows[i], categoryId: fb.id, categoryName: fb.name, classifiedBy: 'fallback' }
      }
    }
  }
  return { rows: out, aiUsed, aiError }
}
