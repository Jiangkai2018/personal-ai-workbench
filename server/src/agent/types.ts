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

export interface AgentConfig {
  providers: ProviderConfig[]
  defaultModel: { providerId: string; model: string }
  /** 联网搜索降级链，M3 启用；M1 仅落字段占位 */
  webSearch?: { order: string[]; searxngBaseURL?: string }
}

/** 对话线程 = data/agent/threads/<id>.json（ADR-0004：会话定向豁免「一切皆 md」） */
export interface AgentThread {
  id: string
  title: string
  created_at: string
  updated_at: string
  archived?: boolean
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
