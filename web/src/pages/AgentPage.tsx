// AI Agent 主页面（M1）：左 = 会话列表；中 = 流式对话；右 = 产物预览位（M2 启用）
// 自管会话列表：切换/新建通过 remount runtime 恢复历史（历史消息由服务端 JSON 落盘，见 ADR-0004）
// 0828-01 §3：深链 ?thread= 打开会话；推送开关；「运行中」标记 + status 轮询 + 结束自动拉全文
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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

function ThreadView({ threadId }: { threadId: string }) {
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
            {/* 手动停止走服务端 stop 端点（0828-01 §3.1）：打标 manual-stop，跑完不推送。
                与 Composer 自带的取消（仅断开本地流）语义不同——后者断连反而会续跑+推送。 */}
            <ThreadPrimitive.If running>
              <button
                type="button"
                data-testid="ag-stop"
                onClick={() => {
                  void fetch(`/api/agent/threads/${encodeURIComponent(threadId)}/stop`, { method: 'POST' })
                }}
                className="shrink-0 self-center rounded-full border border-danger px-3 py-1 text-xs text-danger transition hover:bg-danger-soft"
              >
                停止
              </button>
            </ThreadPrimitive.If>
            <ComposerPrimitive.Input
              autoFocus
              rows={1}
              data-testid="ag-composer-input"
              placeholder="问点什么…（Enter 发送，Shift+Enter 换行）"
              className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-[0.95rem] text-ink outline-none placeholder:text-muted"
            />
            <ComposerPrimitive.Send
              data-testid="ag-send"
              className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-4 py-1.5 text-sm text-white transition hover:bg-accent-deep disabled:opacity-35"
            >
              {/* bug082703：Send 原先无 children 渲染成空胶囊不可见，补箭头图标 + 文案 */}
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                aria-hidden
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
              发送
            </ComposerPrimitive.Send>
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
  // ── 0828-01 §3：深链 / 推送开关 / 运行中标记 ──
  const [searchParams, setSearchParams] = useSearchParams()
  const [notifyEnabled, setNotifyEnabled] = useState(false)
  const [pushOn, setPushOn] = useState(false)
  const [running, setRunning] = useState(false)
  const deepLinkDone = useRef('')
  const pendingDeepLink = useRef('')
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

  // 推送可用性（未配置 → 开关置灰，提示去配置）
  useEffect(() => {
    agentApi.getNotifyEnabled().then(setNotifyEnabled).catch(() => setNotifyEnabled(false))
  }, [])

  // 深链 ?thread=<id>：先把待打开 id 记下（此时 handleOpen 尚未声明），参数立刻清掉
  useEffect(() => {
    const tid = searchParams.get('thread')
    if (tid && tid !== deepLinkDone.current) {
      deepLinkDone.current = tid
      pendingDeepLink.current = tid
      setSearchParams({}, { replace: true })
    }
  }, [searchParams, setSearchParams])

  // 运行中轮询：active 会话每 4s 查一次；运行 → 结束的沿上自动拉全文刷新视图
  useEffect(() => {
    if (!active) {
      setRunning(false)
      return
    }
    const id = active.id
    let wasRunning = false
    const poll = async () => {
      try {
        const s = await agentApi.getRunStatus(id)
        setRunning(s.running)
        if (wasRunning && !s.running) {
          // 后台跑完了：拉全文重挂载视图
          const full = await agentApi.getThread(id)
          setActive((cur) => (cur?.id === id ? { id, initialMessages: full?.messages ?? [] } : cur))
          refreshThreads()
        }
        wasRunning = s.running
      } catch {
        /* 忽略轮询错误 */
      }
    }
    void poll()
    const timer = setInterval(poll, 4000)
    return () => clearInterval(timer)
  }, [active?.id, refreshThreads])

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
        setPushOn(!!full?.pushOnCompletion)
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [active],
  )
  // handleOpen 就绪后处理待打开的深链（deepLinkDone 保证只处理一次）
  useEffect(() => {
    const tid = pendingDeepLink.current
    if (tid) {
      pendingDeepLink.current = ''
      void handleOpen(tid)
    }
  })

  // 推送开关：写会话 JSON（/chat 时服务端读取）；未配置钉钉时置灰
  const togglePush = useCallback(
    (next: boolean) => {
      if (!active) return
      setPushOn(next)
      agentApi.patchThread(active.id, { pushOnCompletion: next }).catch((e) => {
        setPushOn(!next)
        setError((e as Error).message)
      })
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
          <>
            {/* 推送开关 + 运行中标记（0828-01 §3.1/§3.2） */}
            <div className="flex items-center justify-between border-b border-line bg-card px-4 py-1.5" data-testid="ag-push-bar">
              <span className="text-xs text-muted">{active.id}</span>
              <div className="flex items-center gap-3">
                {running && (
                  <span data-testid="ag-running" className="text-xs text-accent-deep">
                    ⏳ 运行中（断开也会跑完并推送）
                  </span>
                )}
                <label
                  className={`flex items-center gap-1.5 text-xs ${notifyEnabled ? 'text-ink' : 'text-muted'}`}
                  title={notifyEnabled ? '开启后：跑完（或关页断网）会把结果推送到钉钉群' : '未配置钉钉群机器人：请在 data/config/ai-providers.json 配置 notify.dingtalk'}
                >
                  <input
                    type="checkbox"
                    data-testid="ag-push-toggle"
                    checked={pushOn}
                    disabled={!notifyEnabled || running}
                    onChange={(e) => togglePush(e.target.checked)}
                  />
                  完成后钉钉推送{notifyEnabled ? '' : '（未配置）'}
                </label>
              </div>
            </div>
            <RuntimeGate key={active.id} id={active.id} initialMessages={active.initialMessages} onTurnEnd={refreshThreads}>
              <ThreadView threadId={active.id} />
            </RuntimeGate>
          </>
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
