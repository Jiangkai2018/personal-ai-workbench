// 领域分析报告生成器：对机会做三段式深度分析（异步长任务，分钟级）。
// 与 AI 初评同理：只产出建议性内容，不改变任何承诺状态（ADR-0003）。
import { AiError } from './scoreClient'

export interface ReportInput {
  title: string
  note?: string
}

export interface ReportGenerator {
  /** 实际使用的模型名（写入报告 frontmatter 供追溯） */
  model: string
  /** 生成分完整的 markdown 报告；失败抛 AiError（消息可直接展示） */
  generate(input: ReportInput): Promise<string>
}

const ROLE_PROMPT = `你是一位资深的行业分析师，为一位准备切入某个领域的个人创作者/开发者服务。
你的分析以数据说话：能量化的量化（粉丝量级、更新频率、收入区间、市场规模量级），
列举真实存在的代表性账号/产品/公司，并明确标注哪些是估计值。

写作规范：
- 使用简体中文 markdown
- 只写指定章节的内容，不要重复其他章节
- 不要使用 markdown 表格（用列表代替）
- 结论要可执行、有取舍，不要空话`

interface Section {
  heading: string
  brief: string
}

/** 三段式：每段一次独立调用，规避单次输出长度限制，换取深度 */
const SECTIONS: Section[] = [
  {
    heading: '一、赛道与市场',
    brief: `本节覆盖：
- 赛道定义与主要细分方向（内容形态、人群切分）
- 目标人群画像与核心需求场景
- 市场规模量级与近两年趋势（标注为估计）
- 主要平台格局（抖音/小红书/视频号/公众号/B站/其他，视领域取舍）及各平台的生态位
- 变现模式全景（广告/带货/知识付费/私域/服务/产品等）与各模式的典型收入量级`,
  },
  {
    heading: '二、同行格局（重点：现实数据）',
    brief: `本节覆盖：
- 头部/腰部/尾部账号的典型数据画像：粉丝量级、内容形式、更新频率、变现方式
- 列举至少 5 个真实存在的代表性账号/IP/团队（基于你掌握的公开信息，注明信息可能滞后）
- 爆款内容模式与选题规律（什么样的内容在这个赛道跑得动）
- 竞争强度评估：内容同质化程度、平台态度（扶持/限流）、新进入者的真实壁垒`,
  },
  {
    heading: '三、切入策略与结论',
    brief: `本节覆盖：
- 差异化切入角度建议（人设、细分定位、内容形式，给出 2-3 个具体方向）
- 冷启动 90 天路径：分阶段目标与关键动作
- 收入预期区间（保守/中性两档，标注假设条件）
- 风险清单（平台政策、内容监管、时间投入、变现周期）
- 综合评级：个人切入难度 1-5 分（5 最难）+ 一句话理由`,
  },
]

function extractText(data: unknown): string {
  const content = (data as { content?: { type: string; text?: string }[] })?.content
  return content?.find((c) => c.type === 'text')?.text ?? ''
}

export function createReportGenerator(): ReportGenerator {
  const apiKey = process.env.WORKBENCH_AI_API_KEY
  const baseUrl = (process.env.WORKBENCH_AI_BASE_URL || 'https://open.bigmodel.cn/api/anthropic').replace(/\/+$/, '')
  const model = process.env.WORKBENCH_AI_MODEL || 'glm-5.3'

  async function call(userText: string, maxTokens: number): Promise<string> {
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
          system: ROLE_PROMPT,
          messages: [{ role: 'user', content: userText }],
        }),
        signal: AbortSignal.timeout(180_000),
      })
    } catch {
      throw new AiError('AI 接口无法连接，请检查网络或 WORKBENCH_AI_BASE_URL')
    }
    if (!res.ok) {
      throw new AiError(`AI 接口返回 ${res.status}，请检查 WORKBENCH_AI_API_KEY / WORKBENCH_AI_MODEL`)
    }
    const text = extractText(await res.json())
    if (!text.trim()) {
      throw new AiError('AI 返回内容为空')
    }
    return text.trim()
  }

  return {
    model,
    async generate(input: ReportInput): Promise<string> {
      const context = [
        `机会标题：${input.title}`,
        input.note?.trim() ? `背景备注：${input.note.trim()}` : '背景备注：（无）',
      ].join('\n')

      const parts: string[] = []
      for (const section of SECTIONS) {
        const body = await call(
          `${context}\n\n请撰写报告的「${section.heading}」一节。\n\n${section.brief}`,
          3000,
        )
        // 模型常在正文开头重复一遍章节标题，去掉首个标题行（内部子标题保留）
        const stripped = body.replace(/^#{1,4}\s+[^\n]*\n+/, '')
        parts.push(`## ${section.heading}\n\n${stripped}`)
      }

      const stamp = new Date().toISOString().slice(0, 10)
      return [
        `# 「${input.title}」领域分析报告`,
        '',
        `> 生成于 ${stamp} · 模型 ${model} · 由 AI 基于训练知识生成，同行数据为截至模型知识截止的公开信息，重要决策请自行核实最新情况。`,
        '',
        ...parts,
      ].join('\n')
    },
  }
}
