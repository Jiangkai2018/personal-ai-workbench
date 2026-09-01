// 网络搜索多 provider 降级链单测（0830-01 §3.8）：全走注入缝 / fake client，不真连 MCP
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { jsonSchema, tool } from 'ai'
import type { ToolSet } from 'ai'
import { __resetSearchStateForTest, bridgeClientTools, getWebSearchTools, resolveProvider } from './webSearch'
import type { ResolvedProvider } from './webSearch'
import type { AgentConfig } from './types'

const ENV_KEYS = [
  'WORKBENCH_SEARCH_API_KEY',
  'WORKBENCH_SEARCH_MCP_API_KEY',
  'WORKBENCH_SEARCH_MCP_URL',
  'WORKBENCH_SEARCH_MCP',
  'WORKBENCH_SEARCH_MINIMAX_KEY',
  'WORKBENCH_AI_API_KEY',
] as const
let savedEnv: Record<string, string | undefined>

const loadNull = () => Promise.resolve(null as AgentConfig | null)

function fakeToolset(name = 'web_search'): ToolSet {
  return {
    [name]: tool({
      description: 'fake',
      inputSchema: jsonSchema({ type: 'object' } as Parameters<typeof jsonSchema>[0]),
      execute: async () => 'fake-result',
    }),
  }
}

beforeEach(() => {
  savedEnv = {}
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  // 两把 key 都给上，候选齐整；具体 case 再按需删除
  process.env.WORKBENCH_SEARCH_API_KEY = 'k-bigmodel'
  process.env.WORKBENCH_SEARCH_MINIMAX_KEY = 'k-minimax'
  __resetSearchStateForTest()
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
})

describe('resolveProvider 配置解析', () => {
  it('bigmodel 走 http + env key；minimax 走 stdio + 子进程 env；旧字段映射到 bigmodel', () => {
    const big = resolveProvider('bigmodel-mcp', null)
    expect(big?.transport).toBe('http')
    expect(big?.url).toContain('bigmodel.cn')
    expect(big?.apiKey).toBe('k-bigmodel')

    const mini = resolveProvider('minimax-mcp', null)
    expect(mini?.transport).toBe('stdio')
    expect(mini?.command).toBe('uvx')
    expect(mini?.env?.MINIMAX_API_KEY).toBe('k-minimax')

    // 旧字段（1 个 release 向后兼容）映射成 providers['bigmodel-mcp']
    delete process.env.WORKBENCH_SEARCH_API_KEY
    const legacy = resolveProvider('bigmodel-mcp', {
      providers: [],
      defaultModel: { providerId: 'x', model: 'y' },
      webSearch: { order: [], mcpUrl: 'http://legacy/mcp', mcpApiKey: 'old-key' },
    })
    expect(legacy?.url).toBe('http://legacy/mcp')
    expect(legacy?.apiKey).toBe('old-key')
  })
})

describe('多 provider 降级链（0830-01 §3.8 五 case）', () => {
  it('case1：bigmodel 连接失败 → 降级用 minimax 工具集', async () => {
    const attempts: string[] = []
    const tools = await getWebSearchTools('x', loadNull, {
      bridgeOne: async (p) => {
        attempts.push(p.id)
        if (p.id === 'bigmodel-mcp') throw new Error('connect fail')
        return { tools: fakeToolset(), close: () => {} }
      },
    })
    expect(attempts).toEqual(['bigmodel-mcp', 'minimax-mcp'])
    expect(Object.keys(tools)).toContain('web_search')
  })

  it('case2：全部失败 → 返回空集不抛错', async () => {
    const attempts: string[] = []
    const tools = await getWebSearchTools('x', loadNull, {
      bridgeOne: async (p) => {
        attempts.push(p.id)
        throw new Error('down')
      },
    })
    expect(tools).toEqual({})
    expect(attempts).toEqual(['bigmodel-mcp', 'minimax-mcp']) // searxng 未实现不在候选
  })

  it('case3：searxng（未实现）与缺 key 的 provider 被跳过，不报错', async () => {
    expect(resolveProvider('searxng', null)).toBeNull()
    delete process.env.WORKBENCH_SEARCH_MINIMAX_KEY
    expect(resolveProvider('minimax-mcp', null)).toBeNull()

    const cfg: AgentConfig = {
      providers: [],
      defaultModel: { providerId: 'x', model: 'y' },
      webSearch: { order: ['searxng', 'minimax-mcp'] },
    }
    let called = 0
    const tools = await getWebSearchTools('x', () => Promise.resolve(cfg), {
      bridgeOne: async () => {
        called++
        return { tools: fakeToolset(), close: () => {} }
      },
    })
    expect(tools).toEqual({})
    expect(called).toBe(0) // 候选为空，装配根本没发生
  })

  it('case4：缓存生效后 callTool 抛错 → 缓存失效，下一轮装配自动换下一家', async () => {
    // 真实 bridgeClientTools + fake client：execute 抛错必须触发 onCallError
    let callToolShouldFail = false
    let invalidated = false
    const fakeClient = {
      listTools: async () => ({ tools: [{ name: 'web_search', description: '', inputSchema: { type: 'object' } }] }),
      callTool: async () => {
        if (callToolShouldFail) throw new Error('鉴权过期')
        return { content: [{ type: 'text', text: 'ok' }] }
      },
    } as unknown as Parameters<typeof bridgeClientTools>[0]
    const bridged = await bridgeClientTools(fakeClient, () => {
      invalidated = true
      __resetSearchStateForTest() // 与 defaultBridgeOne 内置回调等价：cache = null
    })

    // bigmodel 先成功进缓存
    let bigmodelUp = true
    const state = { assembled: 0 }
    const deps = {
      bridgeOne: async (p: ResolvedProvider): Promise<{ tools: ToolSet; close: () => void }> => {
        state.assembled++
        if (p.id === 'bigmodel-mcp') {
          if (!bigmodelUp) throw new Error('down')
          return { tools: bridged, close: () => {} }
        }
        return { tools: fakeToolset(), close: () => {} }
      },
    }
    const first = await getWebSearchTools('x', loadNull, deps)
    expect(Object.keys(first)).toContain('web_search')

    // callTool 失败 → execute 抛错 + onCallError 触发缓存失效
    callToolShouldFail = true
    bigmodelUp = false
    await expect(
      (first.web_search as unknown as { execute: (a: unknown, b?: unknown) => Promise<unknown> }).execute({}),
    ).rejects.toThrow('鉴权过期')
    expect(invalidated).toBe(true)

    // 下一轮：缓存已失效 → 重新装配 → bigmodel 挂 → minimax 顶上（自动降级）
    // bridgeOne 按候选计：第 1 轮 bigmodel 成功 1 次；第 2 轮 bigmodel 失败 + minimax 成功 2 次
    const second = await getWebSearchTools('x', loadNull, deps)
    expect(state.assembled).toBe(3)
    expect(Object.keys(second)).toContain('web_search') // minimax 的同名 fake 工具
  })

  it('case5：并发调用单飞——bridgeOne 只装配一次', async () => {
    let calls = 0
    const deps = {
      bridgeOne: async (): Promise<{ tools: ToolSet; close: () => void }> => {
        calls++
        await new Promise((r) => setTimeout(r, 80))
        return { tools: fakeToolset(), close: () => {} }
      },
    }
    const [a, b] = await Promise.all([getWebSearchTools('x', loadNull, deps), getWebSearchTools('x', loadNull, deps)])
    expect(calls).toBe(1)
    expect(Object.keys(a)).toContain('web_search')
    expect(b).toBe(a) // 同一份缓存工具集
  })
})
