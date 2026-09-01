// 网络查询工具接入（bug082702-6 起 / 0830-01 §3 重构为多 provider 降级链）
// 形态：按 order 逐个尝试候选 MCP（装配时切换；callTool 失败置缓存失效，下轮自动降级）。
// - bigmodel-mcp：Streamable HTTP + Bearer Key（主路）
// - minimax-mcp：stdio 子进程（uvx minimax-coding-plan-mcp），key 走子进程环境变量
// - searxng：暂未实现，order 出现时静默跳过
// 职责：把远端 MCP 工具桥接为 AI SDK v7 的 ToolSet 注入 streamText；
// 任何失败都降级为「无工具」，绝不阻塞对话主链路。
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ToolSet } from 'ai'
import { jsonSchema, tool } from 'ai'
import type { AgentConfig, WebSearchProvider } from './types'

/** bigmodel 搜索 MCP 默认端点（文档见 docs.bigmodel.cn/cn/coding-plan/mcp/search-mcp-server） */
const DEFAULT_SEARCH_MCP_URL = 'https://open.bigmodel.cn/api/mcp/web_search_prime/mcp'
const DEFAULT_ORDER = ['bigmodel-mcp', 'minimax-mcp', 'searxng']
/** stdio 首连冷启（uvx 拉包）给足耐心；缓存换血重建时收紧 */
const STDIO_FIRST_CONNECT_TIMEOUT_MS = 60_000
const STDIO_REBUILD_TIMEOUT_MS = 30_000
/** 进程级缓存：避免每个请求重复 MCP 握手 / 重复 spawn 子进程；15 分钟后失效重建 */
const CACHE_TTL_MS = 15 * 60_000

/** 解析后的候选 provider 形态（schema 见 types.ts WebSearchProvider） */
export interface ResolvedProvider extends WebSearchProvider {
  id: string
}

// ── 模块级状态（进程生命周期）─────────────────────────
let cache: { fingerprint: string; tools: ToolSet; at: number; close: () => void } | null = null
let building: Promise<ToolSet> | null = null
/** 活连接台账：装配期候选 + 当前在用；进程退出时统一 close（stdio 下 = 杀子进程） */
const liveCloses = new Set<() => void>()

// 退出清理只在模块级注册一次（放 getWebSearchTools 里会随缓存重建越挂越多）
function closeAll() {
  for (const c of liveCloses) try { c() } catch {}
  liveCloses.clear()
}
process.once('SIGTERM', closeAll)
process.once('SIGINT', closeAll)
process.once('exit', closeAll)

/**
 * 解析单个 provider：内置默认 + 用户配置合并；key 解析后为空 → null（跳过不装配）。
 * 优先级：环境变量 > ai-providers.json 的 providers 字典 > 旧字段映射 > 内置默认。
 */
export function resolveProvider(id: string, config?: AgentConfig | null): ResolvedProvider | null {
  const cfgProvider = config?.webSearch?.providers?.[id]
  if (id === 'bigmodel-mcp') {
    const url = process.env.WORKBENCH_SEARCH_MCP_URL || cfgProvider?.url || config?.webSearch?.mcpUrl || DEFAULT_SEARCH_MCP_URL
    // 密钥优先级：搜索专项 Key > 配置字典 > 旧字段 > 主模型 Key（用户约定：与 GLM 同一把 Key）
    const apiKey =
      process.env.WORKBENCH_SEARCH_API_KEY ||
      process.env.WORKBENCH_SEARCH_MCP_API_KEY ||
      cfgProvider?.apiKey ||
      config?.webSearch?.mcpApiKey ||
      process.env.WORKBENCH_AI_API_KEY ||
      ''
    if (!apiKey) return null
    return { id, transport: 'http', url, apiKey }
  }
  if (id === 'minimax-mcp') {
    const env = {
      MINIMAX_API_HOST: process.env.WORKBENCH_SEARCH_MINIMAX_API_HOST || cfgProvider?.env?.MINIMAX_API_HOST || 'https://api.minimaxi.com',
      MINIMAX_API_KEY: process.env.WORKBENCH_SEARCH_MINIMAX_KEY || cfgProvider?.env?.MINIMAX_API_KEY || '',
    }
    // 空 key 的 uvx 冷启 10-30s 后必然失败，直接跳过不白等
    if (!env.MINIMAX_API_KEY) return null
    return {
      id,
      transport: 'stdio',
      command: process.env.WORKBENCH_SEARCH_MINIMAX_COMMAND || cfgProvider?.command || 'uvx',
      args: cfgProvider?.args?.length ? cfgProvider.args : ['minimax-coding-plan-mcp', '-y'],
      env,
    }
  }
  // searxng 等未实现的 provider：显式配置了就尊重配置，否则跳过
  if (cfgProvider) return { id, ...cfgProvider }
  return null
}

/**
 * 桥接单个 MCP 工具 → AI SDK tool（execute 内调 callTool，结果拼纯文本）。
 * onCallError：callTool 失败回调（用于置缓存失效，防「握手成功但鉴权过期」的切换死角）。
 */
/** 桥接单个 MCP 工具 → AI SDK tool；导出供单测注入 fake client（见 webSearch.test.ts case4） */
export function bridgeClientTools(client: Client, onCallError: () => void): Promise<ToolSet> {
  return (async () => {
    const { tools } = await client.listTools()
    if (!tools.length) throw new Error('MCP 服务端未提供任何工具')
    const set: ToolSet = {}
    for (const t of tools) {
      set[t.name] = tool({
        description: t.description ?? '',
        inputSchema: jsonSchema((t.inputSchema ?? { type: 'object' }) as Parameters<typeof jsonSchema>[0]),
        execute: async (args) => {
          try {
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
          } catch (err) {
            onCallError()
            throw err
          }
        },
      })
    }
    return set
  })()
}

/** 连接单个候选（按 transport 分流）；成功后 close 记入活连接台账 */
async function defaultBridgeOne(provider: ResolvedProvider): Promise<{ tools: ToolSet; close: () => void }> {
  const client = new Client({ name: 'workbench-agent', version: '0.1.0' })
  let transport: StreamableHTTPClientTransport | StdioClientTransport
  if (provider.transport === 'stdio') {
    console.log(`[workbench] ${provider.id} 冷启中…（uvx 首次拉包可能 10-30s）`)
    transport = new StdioClientTransport({
      command: provider.command ?? 'uvx',
      args: provider.args ?? [],
      env: provider.env,
    })
    // 首连冷启 60s；缓存换血重建（旧连接还在）收紧到 30s。超时走 SDK close() 阶梯后抛错降级
    const timeoutMs = cache ? STDIO_REBUILD_TIMEOUT_MS : STDIO_FIRST_CONNECT_TIMEOUT_MS
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`stdio 连接超时（${timeoutMs / 1000}s）`)), timeoutMs)),
    ])
  } else {
    transport = new StreamableHTTPClientTransport(new URL(provider.url!), {
      requestInit: { headers: { Authorization: `Bearer ${provider.apiKey}` } },
    })
    await client.connect(transport)
  }
  const close = () => void client.close().catch(() => {})
  liveCloses.add(close)
  // callTool 失效传导：缓存换血前先置空，下一轮装配自动落到下一家
  const tools = await bridgeClientTools(client, () => {
    if (cache) cache = null
  })
  return { tools, close }
}

/** 按 order 逐个装配：第一个可用者胜出；落选连接即关，缓存换血杀旧连接 */
async function assemble(
  candidates: Array<{ id: string; provider: ResolvedProvider }>,
  fingerprint: string,
  bridgeOne: typeof defaultBridgeOne,
): Promise<ToolSet> {
  for (const { id, provider } of candidates) {
    try {
      const { tools, close } = await bridgeOne(provider)
      if (!Object.keys(tools).length) {
        await close()
        liveCloses.delete(close)
        console.warn(`[workbench] 搜索 MCP「${id}」返回空工具集，降级到下一项`)
        continue
      }
      console.log(`[workbench] 已连接搜索 MCP: ${id} (${Object.keys(tools).join(', ')})`)
      // 关掉本次装配中已打开的落选连接；台账只留当前在用
      for (const c of [...liveCloses]) {
        if (c !== close) {
          try { c() } catch {}
          liveCloses.delete(c)
        }
      }
      const old = cache
      cache = { fingerprint, tools, at: Date.now(), close }
      old?.close() // 缓存换血：关旧连接（stdio 下 = 杀旧子进程并等 exit）
      return tools
    } catch (err) {
      console.warn(`[workbench] 搜索 MCP「${id}」不可用，降级到下一项:`, err instanceof Error ? err.message : err)
    }
  }
  throw new Error('所有搜索 MCP 均不可用')
}

/** 可注入缝：单测传 fake bridgeOne，不真连 MCP */
export interface WebSearchDeps {
  bridgeOne?: typeof defaultBridgeOne
}

/**
 * 获取 Agent 可用的网络查询工具集。
 * - 显式关闭（WORKBENCH_SEARCH_MCP=0）/ 无可用候选 / 全部失败 → 返回空集
 * - 成功结果进程级缓存（单飞防重复 spawn），15 分钟或配置指纹变化后重建
 */
export async function getWebSearchTools(
  _dataDir: string,
  loadConfig: () => Promise<AgentConfig | null>,
  deps: WebSearchDeps = {},
): Promise<ToolSet> {
  if (process.env.WORKBENCH_SEARCH_MCP === '0') return {}
  const bridgeOne = deps.bridgeOne ?? defaultBridgeOne
  const config = await loadConfig().catch(() => null)
  const order = config?.webSearch?.order ?? DEFAULT_ORDER
  const candidates = order
    .map((id) => ({ id, provider: resolveProvider(id, config) }))
    .filter((c): c is { id: string; provider: ResolvedProvider } => c.provider !== null)
  // 指纹覆盖 order + 全部解析后配置，任一变化触发重建
  const fingerprint = JSON.stringify({ order, providers: candidates.map((c) => c.provider) })

  if (cache && cache.fingerprint === fingerprint && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.tools
  }
  building ??= assemble(candidates, fingerprint, bridgeOne) // 单飞：并发请求只装配一次
  try {
    return await building
  } catch {
    console.warn('[workbench] 所有搜索 MCP 均不可用，本轮降级为无工具对话')
    return {}
  } finally {
    building = null
  }
}

/** 单测专用：重置模块级缓存/单飞状态 */
export function __resetSearchStateForTest(): void {
  cache = null
  building = null
}
