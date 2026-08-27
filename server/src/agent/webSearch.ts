// 网络查询工具接入（bug082702-6）：bigmodel web_search_prime MCP Server
// 协议：Streamable HTTP + Bearer API Key（与 Agent 主模型同一把 WORKBENCH_AI_API_KEY）。
// 职责：把远端 MCP 工具桥接为 AI SDK v7 的 ToolSet 注入 streamText；
// 任何连接/握手失败都降级为「无工具」，绝不阻塞对话主链路。
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { ToolSet } from 'ai'
import { jsonSchema, tool } from 'ai'
import type { AgentConfig } from './types'

/** bigmodel 搜索 MCP 默认端点（文档见 docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server） */
const DEFAULT_SEARCH_MCP_URL = 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp'
/** 进程级缓存：避免每个请求重复 MCP 握手；15 分钟后失效重建 */
const CACHE_TTL_MS = 15 * 60_000

let cache: { fingerprint: string; tools: ToolSet; at: number; close: () => void } | null = null
let building: Promise<ToolSet> | null = null

function resolveMcpTarget(dataDir: string, config?: AgentConfig | null): { url: string; apiKey: string } | null {
  const url =
    process.env.WORKBENCH_SEARCH_MCP_URL || config?.webSearch?.mcpUrl || DEFAULT_SEARCH_MCP_URL
  // 密钥优先级：搜索专项 Key > 配置文件 > 主模型 Key（用户约定：与 GLM 同一把 Key）
  const apiKey =
    process.env.WORKBENCH_SEARCH_API_KEY ||
    config?.webSearch?.mcpApiKey ||
    process.env.WORKBENCH_AI_API_KEY ||
    ''
  if (!apiKey) return null
  return { url, apiKey }
}

/** 桥接单个 MCP 工具 → AI SDK tool（execute 内调 callTool，结果拼纯文本） */
async function bridgeClientTools(client: Client): Promise<ToolSet> {
  const { tools } = await client.listTools()
  if (!tools.length) throw new Error('MCP 服务端未提供任何工具')
  const set: ToolSet = {}
  for (const t of tools) {
    set[t.name] = tool({
      description: t.description ?? '',
      inputSchema: jsonSchema((t.inputSchema ?? { type: 'object' }) as Parameters<typeof jsonSchema>[0]),
      execute: async (args) => {
        // 单次搜索限时：上游偶发超时不该拖死整个回答轮次（模型收到错误会自行换措辞重试）
        const SEARCH_TIMEOUT_MS = Number(process.env.WORKBENCH_SEARCH_TIMEOUT_MS || 45_000)
        const res = await Promise.race([
          client.callTool({ name: t.name, arguments: args as Record<string, unknown> }),
          new Promise<never>((_, rej) =>
            setTimeout(() => rej(new Error('网络搜索超时，请调整关键词后重试')), SEARCH_TIMEOUT_MS),
          ),
        ])
        const texts = Array.isArray(res.content)
          ? res.content.map((c) => (c && typeof c === 'object' && 'text' in c ? String(c.text) : '')).filter(Boolean)
          : []
        return texts.join('\n\n') || JSON.stringify(res)
      },
    })
  }
  return set
}

/**
 * 获取 Agent 可用的网络查询工具集。
 * - 未配 Key / 显式关闭（WORKBENCH_SEARCH_MCP=0）/ 连接失败 → 返回空集
 * - 成功结果进程级缓存，失败不缓存（下次请求重试）
 */
export async function getWebSearchTools(dataDir: string, loadConfig: () => Promise<AgentConfig | null>): Promise<ToolSet> {
  if (process.env.WORKBENCH_SEARCH_MCP === '0') return {}
  let config: AgentConfig | null = null
  try {
    config = await loadConfig()
  } catch {
    // 配置读不到按 null 处理
  }
  const target = resolveMcpTarget(dataDir, config)
  if (!target) return {}

  const fp = `${target.url}|${target.apiKey.slice(-6)}`
  if (cache && cache.fingerprint === fp && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.tools
  }

  building ??= (async () => {
    const client = new Client({ name: 'workbench-agent', version: '0.1.0' })
    const transport = new StreamableHTTPClientTransport(new URL(target.url), {
      requestInit: { headers: { Authorization: `Bearer ${target.apiKey}` } },
    })
    await client.connect(transport)
    const tools = await bridgeClientTools(client)
    const old = cache
    cache = {
      fingerprint: fp,
      tools,
      at: Date.now(),
      close: () => void client.close().catch(() => {}),
    }
    old?.close()
    console.log(`[workbench] 已连接搜索 MCP: ${target.url} (${Object.keys(tools).join(', ')})`)
    return tools
  })()

  try {
    return await building
  } catch (err) {
    console.warn('[workbench] 搜索 MCP 连接失败，本轮降级为无工具对话:', err instanceof Error ? err.message : err)
    return {}
  } finally {
    building = null
  }
}
