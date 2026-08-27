// Agent 会话 REST 封装（会话主体走 SSE 由 transport 处理，这里只管 CRUD）
import type { UIMessage } from 'ai'

export interface ThreadMeta {
  id: string
  title: string
  created_at: string
  updated_at: string
  archived?: boolean
  model?: { providerId: string; model: string } | null
  usage?: unknown
}

export interface ThreadFull extends ThreadMeta {
  messages: UIMessage[]
}

async function json<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
    throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function listThreads(): Promise<ThreadMeta[]> {
  return json<ThreadMeta[]>('/api/agent/threads')
}

export function createThread(): Promise<ThreadFull> {
  return json<ThreadFull>('/api/agent/threads', { method: 'POST', body: '{}' })
}

export function getThread(id: string): Promise<ThreadFull | null> {
  return getJsonOr502Null(`/api/agent/threads/${encodeURIComponent(id)}`)
}

async function getJsonOr502Null(url: string): Promise<ThreadFull | null> {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<ThreadFull>
}

export function renameThread(id: string, title: string): Promise<void> {
  return fetch(`/api/agent/threads/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  }).then((r) => {
    if (!r.ok) throw new Error('重命名失败')
  })
}

export function deleteThread(id: string): Promise<void> {
  return fetch(`/api/agent/threads/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => {
    if (!r.ok) throw new Error('删除失败')
  })
}
