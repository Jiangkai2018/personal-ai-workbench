// AI Agent 主页面（M1）：左 = 会话列表；中 = 流式对话；右 = 产物预览位（M2 启用）
// 自管会话列表：切换/新建通过 remount runtime 恢复历史（历史消息由服务端 JSON 落盘，见 ADR-0004）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import '../styles/agent.css'
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
} from '@assistant-ui/react'
import { AssistantChatTransport, useChatRuntime } from '@assistant-ui/ai-sdk'
import type { UIMessage } from 'ai'
import { AssistantMessage, UserMessage } from './agent/MessageRender'
import * as agentApi from './agent/agentApi'

interface Active {
  id: string
  initialMessages: UIMessage[]
}

/** 运行时挂载壳：useChatRuntime 必须在组件里调用；key 重挂载即完成线程切换 */
function RuntimeGate({
  id,
  initialMessages,
  onTurnEnd,
  children,
}: {
  id: string
  initialMessages: UIMessage[]
  onTurnEnd: () => void
  children: React.ReactNode
}) {
  const transport = useMemo(
    () =>
      new AssistantChatTransport({
        api: '/api/agent/chat',
        // assistant-ui 外层线程 id 是 __LOCALID_*：请求体 id 必须改写为服务端会话 id，
        // 否则消息落进孤儿线程、侧栏条目永远空白（刷新恢复即失败）。
        // transport 会被库按线程 clone，只有 initOptions 里的钩子能稳定存活。
        prepareSendMessagesRequest: async ({ id: _outerId, messages, trigger, messageId, body }) => ({
          body: { ...(body ?? {}), id, messages, trigger, messageId },
        }),
      }),
    [id],
  )
  const finishRef = useRef(onTurnEnd)
  // 最新 ref 写法需在 effect 内赋值（渲染期写 ref 会被 react-hooks/refs 拦下；
  // onFinish 在流结束后才触发，commit 后赋值即可覆盖）
  useEffect(() => {
    finishRef.current = onTurnEnd
  })
  const runtime = useChatRuntime({
    transport,
    id,
    messages: initialMessages,
    onFinish: useCallback(() => finishRef.current(), []),
  })
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}

function ThreadView() {
  const [showBackBottom, setShowBackBottom] = useState(false)

  // 贴底监测：滚动与内容增长（ResizeObserver）都要看；「跟随」本身交给 Viewport 的 autoScroll
  useEffect(() => {
    const el = document.getElementById('ag-viewport')
    if (!el) return
    const sync = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 32
      setShowBackBottom(el.scrollHeight > el.clientHeight + 24 && !nearBottom)
    }
    el.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', sync)
      ro.disconnect()
    }
  }, [])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
        <ThreadPrimitive.Viewport
          id="ag-viewport"
          autoScroll
          className="ag-scroll min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8"
        >
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
            <ThreadPrimitive.Empty>
              <div className="mt-[18vh] text-center">
                <p className="font-serif text-xl text-ink">从一次提问开始</p>
                <p className="mt-2 text-sm text-muted">闲聊、调研、政策分析……或让 TA 帮你查知识库里的旧笔记。</p>
              </div>
            </ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </div>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>

      {showBackBottom && (
        <button type="button" className="ag-back-bottom" onClick={() =>
          document.getElementById('ag-viewport')?.scrollTo({ top: 9e9, behavior: 'smooth' })
        }>
          ↓ 回到底部
        </button>
      )}

      <div className="border-t border-line bg-card-warm px-4 py-3 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <ComposerPrimitive.Root className="flex items-end gap-2 rounded-[var(--radius-ag)] border border-line bg-card p-2 shadow-sm focus-within:border-line-strong">
            <ComposerPrimitive.Input
              autoFocus
              rows={1}
              data-testid="ag-composer-input"
              placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[0.95rem] text-ink outline-none placeholder:text-muted"
            />
            <ComposerPrimitive.Send data-testid="ag-send" className="rounded-full bg-accent px-4 py-1.5 text-sm text-white transition hover:bg-accent-deep disabled:opacity-35" />
          </ComposerPrimitive.Root>
          <p className="mt-1.5 text-center text-xs text-muted">
            内容也会保存到本地会话记录 · 政策类问题可要求注明权威信源
          </p>
        </div>
      </div>
    </div>
  )
}

export default function AgentPage() {
  const [threads, setThreads] = useState<agentApi.ThreadMeta[]>([])
  const [active, setActive] = useState<Active | null>(null)
  const [error, setError] = useState('')
  // 产物预览面板：默认收起，右缘把手展开；localStorage 记忆（沙箱环境 try/catch 兜底）
  const [previewOpen, setPreviewOpen] = useState(() => {
    try {
      return localStorage.getItem('workbench.agent.preview') === '1'
    } catch {
      return false
    }
  })
  const togglePreview = useCallback((v: boolean) => {
    setPreviewOpen(v)
    try {
      localStorage.setItem('workbench.agent.preview', v ? '1' : '0')
    } catch {
      /* 忽略存储失败 */
    }
  }, [])

  const refreshThreads = useCallback(() => {
    agentApi
      .listThreads()
      .then(setThreads)
      .catch((e) => setError(e.message))
  }, [])
  useEffect(refreshThreads, [refreshThreads])

  const handleNew = useCallback(async () => {
    try {
      const t = await agentApi.createThread()
      setActive({ id: t.id, initialMessages: [] })
      refreshThreads()
    } catch (e) {
      setError((e as Error).message)
    }
  }, [refreshThreads])

  const handleOpen = useCallback(
    async (id: string) => {
      if (active?.id === id) return
      try {
        const full = await agentApi.getThread(id)
        setActive({ id, initialMessages: full?.messages ?? [] })
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [active],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      if (!window.confirm('删除这条会话？该操作不可恢复。')) return
      try {
        await agentApi.deleteThread(id)
        if (active?.id === id) setActive(null)
        refreshThreads()
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [active, refreshThreads],
  )

  return (
    <div className="agent-shell flex h-[calc(100dvh-150px)] min-h-[420px] gap-0 overflow-hidden rounded-[var(--radius)] border border-line bg-paper md:h-[calc(100dvh-108px)]">
      {/* ── 左栏：会话列表 ── */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-card-warm md:flex">
        <button
          type="button"
          data-testid="ag-new-thread"
          onClick={handleNew}
          className="m-3 rounded-[var(--radius-ag-sm)] bg-accent px-3 py-2 text-sm text-white transition hover:bg-accent-deep"
        >
          ＋ 新建对话
        </button>
        <nav className="ag-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3" aria-label="历史会话">
          {threads.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted">还没有会话</p>}
          {threads.map((t) => (
            <div
              key={t.id}
              data-testid="ag-thread-item"
              className={`group mb-0.5 flex items-center rounded-[var(--radius-ag-sm)] pl-2 pr-1 ${
                active?.id === t.id ? 'bg-accent-soft' : 'hover:bg-paper-deep'
              }`}
            >
              <button
                type="button"
                onClick={() => handleOpen(t.id)}
                className="min-w-0 flex-1 py-2 pr-1 text-left"
              >
                <span className="block truncate text-sm text-ink">{t.title}</span>
                <span className="block text-[11px] tabular-nums text-muted">
                  {t.updated_at ? new Date(t.updated_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </button>
              <button
                type="button"
                aria-label={`删除 ${t.title}`}
                onClick={() => handleDelete(t.id)}
                className="invisible shrink-0 rounded px-1.5 py-1 text-xs text-muted hover:text-accent group-hover:visible"
              >
                删
              </button>
            </div>
          ))}
        </nav>
      </aside>

      {/* ── 中栏：对话 ── */}
      {/* min-h-0 是整条高度链的地基：section 是 shell（行向 flex）的交叉轴 item，
          默认 min-height:auto 会被内容最小高度顶破固定高，视口永不溢出、内滚无从发生 */}
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-line bg-card px-4 py-2 md:hidden">
          <span className="font-serif text-base">Agent</span>
          <button
            type="button"
            data-testid="ag-new-thread-mobile"
            onClick={handleNew}
            className="rounded-full bg-accent px-3 py-1 text-xs text-white"
          >
            ＋ 新建
          </button>
        </header>

        {error && (
          <p role="alert" className="mx-4 mt-2 rounded bg-danger-soft px-3 py-1.5 text-xs text-danger">
            {error}
            <button type="button" className="ml-2 underline" onClick={() => setError('')}>
              知道了
            </button>
          </p>
        )}

        {active ? (
          <RuntimeGate key={active.id} id={active.id} initialMessages={active.initialMessages} onTurnEnd={refreshThreads}>
            <ThreadView />
          </RuntimeGate>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <button
              type="button"
              onClick={handleNew}
              className="rounded-[var(--radius-ag)] border border-dashed border-line-strong bg-card px-6 py-5 text-center transition hover:border-accent"
            >
              <p className="font-serif text-lg text-ink">开始一段新对话</p>
              <p className="mt-1 text-xs text-muted">点击新建，或在左侧选择历史会话继续</p>
            </button>
          </div>
        )}
      </section>

      {/* ── 右栏：产物预览（M2 上线文档卡片联动）──
          默认收起为右缘把手（localStorage 记忆展开态），把手 chevron 旋转、面板 width 过渡滑出 */}
      <aside className="agent-preview hidden shrink-0 border-l border-line bg-card-warm xl:flex" data-open={previewOpen}>
        <button
          type="button"
          className="ag-preview-handle"
          aria-expanded={previewOpen}
          aria-label={previewOpen ? '收起产物预览' : '展开产物预览'}
          onClick={() => togglePreview(!previewOpen)}
        >
          <svg
            viewBox="0 0 24 24"
            className={`ag-preview-chevron${previewOpen ? '' : ' closed'}`}
            aria-hidden
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          <span className="ag-preview-handle-text">产物预览</span>
        </button>
        <div className="ag-preview-body" aria-hidden={!previewOpen}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="font-serif text-sm text-ink2">产物</p>
            <button
              type="button"
              className="text-xs text-muted transition hover:text-accent"
              onClick={() => togglePreview(false)}
            >
              收起
              </button>
          </div>
          <div className="px-6 pt-6 text-center">
            <p className="font-serif text-sm text-ink2">产物预览</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Agent 生成的 Markdown 文档将在这里展开阅读，
              <br />
              一句话即可落盘进知识库。
            </p>
          </div>
        </div>
      </aside>
    </div>
  )
}
