// Agent 板块共享类型（V1.1 · M1）
import type { UIMessage } from 'ai'

/** 厂商接入形态（ADR-0005 三档混合：官方包 / OpenAI 兼容 / 本地 fake） */
export type ProviderKind = 'openai' | 'anthropic' | 'deepseek' | 'openai-compatible' | 'fake'

export interface ProviderConfig {
  id: string
  label: string
  kind: ProviderKind
  baseURL?: string
  apiKey?: string
}

/** 联网搜索单个 MCP provider 的接入形态（0830-01 §3） */
export interface WebSearchProvider {
  transport: 'http' | 'stdio'
  url?: string
  apiKey?: string
  command?: string
  args?: string[]
  env?: Record<string, string>
}

export interface AgentConfig {
  providers: ProviderConfig[]
  defaultModel: { providerId: string; model: string }
  /** 联网搜索（bug082702-6 起 bigmodel；0830-01 起多 provider 降级链） */
  webSearch?: {
    order: string[]
    providers?: Record<string, WebSearchProvider>
    /** 旧字段（1 个 release 向后兼容）：自动映射成 providers['bigmodel-mcp'] */
    mcpUrl?: string
    mcpApiKey?: string
  }
  /** 知识库文件工具（0827-03）：敏感目录黑名单（相对 knowledge 根，正斜杠），缺省用内置默认 */
  fileTools?: {
    deny?: string[]
  }
  /** 视觉模型（0828-01）：上传解析的扫描件/图片转写用；未配置则拒收 */
  visionModel?: { providerId: string; model: string }
  /** 完成推送（0828-01 §3.3）：钉钉群自定义机器人（加签） */
  notify?: {
    dingtalk?: {
      enabled: boolean
      webhook?: string
      secret?: string
      baseUrl?: string
    }
  }
}

/** 对话线程 = data/agent/threads/<id>.json（ADR-0004：会话定向豁免「一切皆 md」） */
export interface AgentThread {
  id: string
  title: string
  created_at: string
  updated_at: string
  archived?: boolean
  /** 会话级「完成后钉钉推送」开关（0828-01 §3.1），新会话默认关 */
  pushOnCompletion?: boolean
  model?: { providerId: string; model: string }
  usage?: unknown
  messages: UIMessage[]
}

/** 列表页用的元信息（不带消息体） */
export type ThreadMeta = Omit<AgentThread, 'messages'>

export interface ModelSelection {
  providerId?: string
  model?: string
}
