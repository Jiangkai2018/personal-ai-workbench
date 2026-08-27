// 模型解析器：厂商配置 → LanguageModel 实例（ADR-0005 三档混合接入）
// 解析顺序：WORKBENCH_AGENT_FAKE=1 强制 fake（测试/演示）→ 配置文件按 providerId/defaultModel → 环境变量兜底
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import type { LanguageModel } from 'ai'
import { AiError } from '../ai/scoreClient'
import { envFallbackProvider, loadAgentConfig } from './providerConfig'
import type { ModelSelection, ProviderConfig } from './types'

export type AgentModelResolver = (selection?: ModelSelection) => Promise<LanguageModel>

function resolveProvider(providers: ProviderConfig[], selection?: ModelSelection): ProviderConfig {
  if (selection?.providerId) {
    const found = providers.find((p) => p.id === selection.providerId)
    if (!found) throw new AiError(`未知的 AI 厂商：${selection.providerId}`)
    return found
  }
  return providers[0]
}

/** fake 模型：确定性伪流输出，e2e / 无 Key 演示专用 */
async function fakeModel(modelId: string): Promise<LanguageModel> {
  const { MockLanguageModelV4, simulateReadableStream } = await import('ai/test')
  const reply =
    '这是 FAKE 模式的确定性回复。\n\n' +
    '- 流式分片会逐段到达\n' +
    '- 会话内容落盘在 data/agent/threads/\n' +
    '- 刷新页面后从左侧历史列表点开即可恢复本对话\n\n' +
    '接好真实厂商后，这里就是你的模型输出。'
  const chunks: LanguageModelV4StreamPart[] = [
    { type: 'text-start', id: 't0' },
    ...reply.split(/(?= )/).map((delta) => ({ type: 'text-delta', id: 't0', delta }) as LanguageModelV4StreamPart),
    { type: 'text-end', id: 't0' },
    {
      type: 'finish',
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 48, text: 48, reasoning: 0 },
      },
    },
  ]
  return new MockLanguageModelV4({
    provider: 'workbench-fake',
    modelId,
    doStream: async () => ({
      stream: simulateReadableStream({ initialDelayInMs: 120, chunkDelayInMs: 18, chunks: [...chunks] }),
    }),
  }) as unknown as LanguageModel
}

/** 按厂商形态实例化真正的 LanguageModel */
function instantiate(provider: ProviderConfig, model: string): LanguageModel {
  switch (provider.kind) {
    case 'openai': {
      const openai = createOpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL })
      return openai(model)
    }
    case 'anthropic': {
      // GLM 的 Anthropic 兼容端点（…/api/anthropic）也走这档，与财务模块同款用法。
      // 两套路径约定并存：scoreClient 自行拼 /v1/messages（.env 的 BASE_URL 不带 /v1），
      // 而 @ai-sdk/anthropic 的 baseURL 须自带 /v1（其只追加 /messages）——此处归一化，
      // 缺 /v1 时会打中 …/anthropic/messages（GLM 返回 200+JSON 错误体 → 流静默无输出）。
      const rawBase = provider.baseURL?.replace(/\/+$/, '') || 'https://api.anthropic.com'
      const sdkBase = /\/v\d+$/.test(rawBase) ? rawBase : `${rawBase}/v1`
      const anthropic = createAnthropic({ apiKey: provider.apiKey, baseURL: sdkBase })
      return anthropic(model)
    }
    case 'deepseek': {
      const deepseek = createDeepSeek({ apiKey: provider.apiKey, baseURL: provider.baseURL })
      return deepseek(model)
    }
    case 'openai-compatible': {
      if (!provider.baseURL) throw new AiError(`厂商「${provider.label}」缺少 baseURL`)
      const compat = createOpenAICompatible({
        name: provider.id,
        apiKey: provider.apiKey ?? '',
        baseURL: provider.baseURL,
      })
      return compat(model)
    }
    default:
      throw new AiError(`不支持的厂商类型：${provider.kind}`)
  }
}

export function createAgentModelResolver(dataDir: string): AgentModelResolver {
  return async (selection) => {
    // e2e / 演示开关：全量走 fake，保证无外部依赖、结果确定
    if (process.env.WORKBENCH_AGENT_FAKE === '1') {
      return fakeModel(selection?.model ?? 'fake-chat')
    }

    const config = await loadAgentConfig(dataDir)
    let providers = config?.providers ?? []
    let defaultSelection = config?.defaultModel

    if (providers.length === 0) {
      const fallback = envFallbackProvider()
      if (!fallback) {
        throw new AiError('Agent 未配置：请在后台配置厂商 API Key，或设置 WORKBENCH_AI_API_KEY')
      }
      providers = [fallback]
      defaultSelection = undefined
    }

    const chosen = selection?.providerId
      ? selection
      : defaultSelection
        ? { providerId: defaultSelection.providerId }
        : { providerId: providers[0].id }
    const provider = resolveProvider(providers, chosen)
    const model = selection?.model ?? defaultSelection?.model ?? 'glm-5.3'

    if (!provider.apiKey && provider.kind !== 'fake') {
      throw new AiError(`厂商「${provider.label}」未配置 API Key`)
    }

    if (provider.kind === 'fake') {
      return fakeModel(model)
    }
    return instantiate(provider, model)
  }
}
