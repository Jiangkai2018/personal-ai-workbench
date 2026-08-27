// 消息渲染件：markdown 正文 + 思考过程折叠 + 工具调用卡（M2 产物卡片再续）
import { useEffect, useRef, useState } from 'react'
import remarkGfm from 'remark-gfm'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import {
  MessagePrimitive,
  useAuiState,
  useMessagePartReasoning,
} from '@assistant-ui/react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'

// GFM：表格 / 删除线 / 任务列表等（bug082702-2：不挂插件时表格以源码块形式展示）
export function MarkdownText() {
  return <MarkdownTextPrimitive className="ag-md" remarkPlugins={[remarkGfm]} />
}

/** 从 args 里猜查询词字段（不同 MCP 服务命名不一：query / search_query / q …） */
function pickQuery(args: Record<string, unknown>): string {
  for (const k of ['query', 'search_query', 'q', 'keyword', 'keywords']) {
    if (typeof args[k] === 'string' && args[k]) return args[k]
  }
  const first = Object.values(args).find((v) => typeof v === 'string')
  return typeof first === 'string' ? first : ''
}

/** 网络搜索工具卡：一行式「🌐 联网搜索：<query>」，完成态附结果规模提示（bug082702-6） */
function WebSearchToolCard({ argsText, result, status }: ToolCallMessagePartProps) {
  let query: string
  try {
    query = pickQuery(JSON.parse(argsText || '{}'))
  } catch {
    query = ''
  }
  let resultText: string
  if (typeof result === 'string') {
    resultText = result
  } else {
    try {
      resultText = JSON.stringify(result ?? '')
    } catch {
      resultText = ''
    }
  }
  const done = Boolean(result)
  return (
    <div data-testid="ag-tool-search" className="my-1 rounded-[var(--radius-ag-sm)] bg-card-warm px-3 py-1.5 text-xs text-muted">
      🌐 联网搜索{query ? <span className="text-ink2">：{query}</span> : null}
      {done ? (
        <span className="ml-1 opacity-70">· 已取回约 {Math.ceil(resultText.length / 100) * 100} 字资料</span>
      ) : status?.type !== 'complete' ? (
        '…'
      ) : (
        ''
      )}
    </div>
  )
}

/** 未注册工具的兜底卡（只露工具名，不吐原始 JSON） */
function ToolFallbackCard({ toolName }: ToolCallMessagePartProps) {
  return (
    <div className="my-1 rounded-[var(--radius-ag-sm)] bg-card-warm px-3 py-1.5 text-xs text-muted">
      🔧 调用工具 <code>{toolName}</code>
    </div>
  )
}

// ── 知识库工具卡（0827-03）：分族呈现，落盘/编辑醒目，其余轻量一行卡 ──

function safeParseArgs(argsText: string): Record<string, unknown> {
  try {
    return JSON.parse(argsText || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

function resultText(result: unknown): string {
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result ?? '')
  } catch {
    return ''
  }
}

/** 从结果串里抓第一个数字（命中数/行数/字节量） */
function pickNumber(text: string, pattern: RegExp): string {
  const m = text.match(pattern)
  return m?.[1] ?? ''
}

interface KbCardSpec {
  testid: string
  /** 卡内主文案：icon + 冒号前缀 + 参数值 */
  render: (args: Record<string, unknown>) => React.ReactNode
  /** 完成态摘要（解析执行结果，缺省「完成」） */
  summary?: (result: string) => string
  /** 醒目卡（落盘/编辑）：accent 底色 + 描边 */
  prominent?: boolean
}

function makeKbCard(spec: KbCardSpec) {
  return function KbToolCard({ argsText, result, status }: ToolCallMessagePartProps) {
    const args = safeParseArgs(argsText)
    const done = Boolean(result)
    const text = resultText(result)
    return (
      <div
        data-testid={spec.testid}
        className={`my-1 rounded-[var(--radius-ag-sm)] px-3 py-1.5 text-xs ${
          spec.prominent ? 'border border-accent/40 bg-accent-soft text-ink' : 'bg-card-warm text-muted'
        }`}
      >
        {spec.render(args)}
        {done ? (
          <span className="ml-1 opacity-70">· {spec.summary?.(text) ?? '完成'}</span>
        ) : status?.type !== 'complete' ? (
          '…'
        ) : (
          ''
        )}
      </div>
    )
  }
}

function argStr(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  return typeof v === 'string' && v ? v : ''
}

const KbWriteCard = makeKbCard({
  testid: 'ag-tool-kb-write',
  prominent: true,
  render: (a) => (
    <>
      📄 落盘<span className="break-all">：{argStr(a, 'path') || '（未指定路径）'}</span>
    </>
  ),
  summary: (r) => `${pickNumber(r, /（(\d+) 字节/)} 字节已写入知识库`,
})

const KbEditCard = makeKbCard({
  testid: 'ag-tool-kb-edit',
  prominent: true,
  render: (a) => (
    <>
      ✏️ 编辑<span className="break-all">：{argStr(a, 'path') || '（未指定路径）'}</span>
    </>
  ),
  summary: (r) => `替换 ${pickNumber(r, /替换 (\d+) 处/) || '1'} 处完成`,
})

const KbReadCard = makeKbCard({
  testid: 'ag-tool-kb-read',
  render: (a) => (
    <>
      📖 读取<span className="break-all">：{argStr(a, 'path')}</span>
    </>
  ),
  summary: (r) => `${pickNumber(r, /共 (\d+) 行/)} 行`,
})

const KbGlobCard = makeKbCard({
  testid: 'ag-tool-kb-glob',
  render: (a) => <>🔍 查找文件：{argStr(a, 'pattern')}</>,
  summary: (r) => `${pickNumber(r, /命中 (\d+) 个文件/)} 个文件`,
})

const KbGrepCard = makeKbCard({
  testid: 'ag-tool-kb-grep',
  render: (a) => <>🔍 搜索内容：{argStr(a, 'pattern')}</>,
  summary: (r) => `${pickNumber(r, /\/ (\d+) 处/)} 处命中`,
})

const KbTreeCard = makeKbCard({
  testid: 'ag-tool-kb-tree',
  render: (a) => <>🗂️ 浏览目录：{argStr(a, 'path') || '全库'}</>,
  summary: (r) => `${pickNumber(r, /（(\d+) 项/)} 项`,
})

const WebFetchCard = makeKbCard({
  testid: 'ag-tool-web-fetch',
  render: (a) => (
    <>
      🌐 抓取网页<span className="break-all">：{argStr(a, 'url')}</span>
    </>
  ),
  summary: (r) => {
    const total = pickNumber(r, /共 (\d+) 字/)
    return total ? `取回正文 ${total} 字` : '已抓取'
  },
})

/** 「正文已开始」判定：本 <details> 之后的兄弟子树里出现非空 .ag-md（Parts 可能包 wrapper，须下探） */
function answerStarted(el: HTMLElement): boolean {
  const parent = el.parentElement
  if (!parent) return false
  let seen = false
  for (const child of parent.children) {
    if (child === el) {
      seen = true
      continue
    }
    if (seen && child.textContent?.trim() && (child.classList.contains('ag-md') || child.querySelector('.ag-md'))) {
      return true
    }
  }
  return false
}

/**
 * 「本块属于最后一条助手气泡」判定（bug082702-5）：
 * thread.isRunning 是全线程状态——历史思考（尤其被中断、无正文的历史轮次）会因新一轮运行
 * 被误判为「自己的思考又开始了」。仅线程中最后一条助手气泡允许进入直播态。
 */
function isLastAssistantBubble(el: HTMLElement): boolean {
  const msg = el.closest('[data-testid="ag-msg-assistant"]')
  if (!msg) return true
  const all = document.querySelectorAll('[data-testid="ag-msg-assistant"]')
  return all[all.length - 1] === msg
}

/**
 * 思考过程折叠块：
 * - 思考中（运行中且本块之后尚无正文）：自动展开直播，「思考中… Ns」呼吸圆点指示
 * - 正文出现：自动收起为「已思考 Ns」，可点击回看
 * - 运行结束仍无正文（流被中断等）：同样收口为「已思考 Ns」（bug082702-4 显示侧）
 * - 历史消息 / 非末条气泡：保持「思考过程」常态，不自动开合（bug082702-5）
 * - 本轮消息内用户手动开合后不再自动干预
 */
export function ReasoningFold() {
  const part = useMessagePartReasoning()
  const isRunning = useAuiState((s) => s.thread.isRunning)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const startRef = useRef<number | null>(null)
  const userTouchedRef = useRef(false)
  const [seconds, setSeconds] = useState<number | null>(null)
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'completed'>('idle')
  const lastAutoRef = useRef<boolean | null>(null) // 最近一次程序化设置，用于区分用户手动开合

  const text = part?.text ?? ''

  useEffect(() => {
    const el = detailsRef.current
    if (!el) return
    if (isRunning && text && !answerStarted(el) && isLastAssistantBubble(el)) {
      startRef.current ??= Date.now()
      setPhase('thinking')
      if (!userTouchedRef.current) {
        lastAutoRef.current = true
        el.open = true
      }
    }
  }, [isRunning, text])

  // 运行结束仍无正文（上游流中断 / 报错）：收口停止计时，不再永远「思考中」（bug082702-4 显示侧）
  useEffect(() => {
    if (isRunning || phase !== 'thinking') return
    if (!userTouchedRef.current) {
      const el = detailsRef.current
      if (el) {
        lastAutoRef.current = false
        el.open = false
      }
    }
    setPhase('completed')
  }, [isRunning, phase])

  // thinking 阶段轮询：秒数跳动 + 正文出现即收起（reasoning 文本停更时 effect 不再触发，须主动轮询）
  useEffect(() => {
    if (phase !== 'thinking') return
    const t = setInterval(() => {
      const el = detailsRef.current
      if (startRef.current != null) setSeconds(Math.round((Date.now() - startRef.current) / 1000))
      if (el && !userTouchedRef.current && answerStarted(el)) {
        lastAutoRef.current = false
        el.open = false
        if (startRef.current != null) setSeconds(Math.round((Date.now() - startRef.current) / 1000))
        setPhase('completed')
      }
    }, 400)
    return () => clearInterval(t)
  }, [phase])

  let summary = '思考过程'
  if (phase === 'thinking') {
    summary = `思考中…${seconds != null ? ` ${seconds}s` : ''}`
  } else if (phase === 'completed' && seconds != null) {
    summary = `已思考 ${seconds}s`
  }

  return (
    <details
      ref={detailsRef}
      className="ag-reasoning my-1 rounded-[var(--radius-ag-sm)] bg-card-warm px-3 py-2"
      onToggle={() => {
        // 程序化设置 open 也会触发 toggle 事件：与最近一次程序化值一致视为「回声」忽略
        const el = detailsRef.current
        if (el && lastAutoRef.current !== null && el.open === lastAutoRef.current) return
        userTouchedRef.current = true
      }}
    >
      <summary>
        {phase === 'thinking' && <span className="ag-think-dot" aria-hidden />}
        {summary}
      </summary>
      <div className="ag-reasoning-body ag-scroll mt-1 whitespace-pre-wrap text-[0.85rem] leading-relaxed text-muted">{text}</div>
    </details>
  )
}

export function AssistantMessage() {
  return (
    <div className="flex w-full justify-start">
      <div data-testid="ag-msg-assistant" className="ag-bubble max-w-[min(860px,92%)] rounded-[var(--radius-ag)] rounded-tl-[6px] border border-line bg-card px-4 py-3">
        <div className="mb-1 flex items-center gap-1.5 text-xs text-muted">
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent font-serif text-[10px] leading-none text-white">工</span>
          <span>助手</span>
        </div>
        <MessagePrimitive.Root>
          <MessagePrimitive.Parts
            components={{
              Text: MarkdownText,
              Reasoning: ReasoningFold,
              tools: {
                by_name: {
                  web_search_prime: WebSearchToolCard,
                  kb_write: KbWriteCard,
                  kb_edit: KbEditCard,
                  kb_read: KbReadCard,
                  kb_glob: KbGlobCard,
                  kb_grep: KbGrepCard,
                  kb_tree: KbTreeCard,
                  web_fetch: WebFetchCard,
                },
                Fallback: ToolFallbackCard,
              },
            }}
          />
        </MessagePrimitive.Root>
      </div>
    </div>
  )
}

export function UserMessage() {
  return (
    <div className="flex w-full justify-end">
      <div data-testid="ag-msg-user" className="max-w-[min(680px,88%)] whitespace-pre-wrap break-words rounded-[var(--radius-ag)] rounded-tr-[6px] bg-accent-soft px-4 py-3 text-ink">
        <MessagePrimitive.Root>
          <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
        </MessagePrimitive.Root>
      </div>
    </div>
  )
}
