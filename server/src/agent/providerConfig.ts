// ai-providers 配置存储：<dataDir>/config/ai-providers.json
// 密钥属敏感信息 —— 文件本身被 .gitignore 覆盖（data/**/），后台页可视化读写（M4）
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AgentConfig, ProviderConfig } from './types'

const providerSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(['openai', 'anthropic', 'deepseek', 'openai-compatible', 'fake']),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
})

const configSchema = z.object({
  providers: z.array(providerSchema).default([]),
  defaultModel: z.object({ providerId: z.string(), model: z.string() }),
  webSearch: z
    .object({
      order: z.array(z.string()).default(['bigmodel-mcp', 'minimax-mcp', 'searxng']),
      searxngBaseURL: z.string().optional(),
    })
    .optional(),
})

function configPath(dataDir: string): string {
  return path.join(dataDir, 'config', 'ai-providers.json')
}

/** 读配置；文件不存在或损坏返回 null（由调用方决定兜底行为） */
export async function loadAgentConfig(dataDir: string): Promise<AgentConfig | null> {
  try {
    const raw = await readFile(configPath(dataDir), 'utf8')
    return configSchema.parse(JSON.parse(raw))
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.warn('[workbench] ai-providers.json 格式错误，忽略该文件', err.issues)
    }
    return null
  }
}

export async function saveAgentConfig(dataDir: string, config: AgentConfig): Promise<void> {
  const parsed = configSchema.parse(config)
  await mkdir(path.join(dataDir, 'config'), { recursive: true })
  await writeFile(configPath(dataDir), JSON.stringify(parsed, null, 2), 'utf8')
}

/**
 * 无配置文件时从旧环境变量兜底（财务模块同一套 WORKBENCH_AI_*）：
 * BASE_URL 含 /anthropic → anthropic 协议；否则按 OpenAI 兼容处理。
 */
export function envFallbackProvider(): ProviderConfig | null {
  const apiKey = process.env.WORKBENCH_AI_API_KEY
  if (!apiKey) return null
  const baseURL = process.env.WORKBENCH_AI_BASE_URL || 'https://open.bigmodel.cn/api/anthropic'
  const model = process.env.WORKBENCH_AI_MODEL || 'glm-5.3'
  const kind = baseURL.includes('/anthropic') ? 'anthropic' : 'openai-compatible'
  return { id: 'env-default', label: '默认（环境变量）', kind, baseURL, apiKey }
}

/** 对外展示时打码密钥，只留尾四位便于辨认 */
export function maskProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map((p) => ({
    ...p,
    apiKey: p.apiKey ? `***${p.apiKey.slice(-4)}` : undefined,
  }))
}
