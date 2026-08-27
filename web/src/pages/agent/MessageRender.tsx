// 消息渲染件：markdown 正文 + 思考过程折叠（M2 再加工具卡片 / 产物卡片）
import { useEffect, useRef, useState } from 'react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { MessagePrimitive, useAuiState, useMessagePartReasoning } from '@assistant-ui/react'

export function MarkdownText() {
  return <MarkdownTextPrimitive className="ag-md" />
}

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
 * 思考过程折叠块：
 * - 思考中（运行中且本块之后尚无正文）：自动展开直播，「思考中… Ns」呼吸圆点指示
 * - 正文出现：自动收起为「已思考 Ns」，可点击回看
 * - 本轮消息内用户手动开合后不再自动干预
 * - 历史消息：保持「思考过程」常态，不自动开合
 */
export function ReasoningFold() {
  const part = useMessagePartReasoning()
  const isRunning = useAuiState((s: any) => s.thread.isRunning)
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
    if (isRunning && text && !answerStarted(el)) {
      startRef.current ??= Date.now()
      setPhase('thinking')
      if (!userTouchedRef.current) {
        lastAutoRef.current = true
        el.open = true
      }
    }
  }, [isRunning, text])

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
      <div className="mt-1 whitespace-pre-wrap text-[0.85rem] leading-relaxed text-muted">{text}</div>
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
          <MessagePrimitive.Parts components={{ Text: MarkdownText, Reasoning: ReasoningFold }} />
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
