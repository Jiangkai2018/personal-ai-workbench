// 极简 fetch 封装：统一 JSON、错误解析为 zod 的 issues 第一条信息
import type { Scope, Track, Idea, Goal, Task, TodayData, SessionUser, Opportunity, Proposal, Review } from '../types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    const msg = body?.issues?.[0]?.message || body?.message || body?.error || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return res.json() as Promise<T>
}

export const api = {
  // 鉴权
  async me(): Promise<SessionUser | null> {
    try {
      return await request<SessionUser>('/api/auth/me')
    } catch {
      return null
    }
  },
  login: (username: string, password: string) =>
    request<SessionUser>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  resetPassword: (input: { username: string; new_password: string; family_username: string; family_password: string }) =>
    request<{ ok: boolean }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // 想法
  createIdea: (input: { content: string; scope: Scope; track: Track }) =>
    request<Idea>('/api/ideas', { method: 'POST', body: JSON.stringify(input) }),
  listIdeas: (scope: Scope) => request<Idea[]>(`/api/ideas?scope=${scope}`),

  // 机会
  createOpportunity: (input: { title: string; scope: Scope; scores: Opportunity['scores']; note?: string }) =>
    request<Opportunity>('/api/opportunities', { method: 'POST', body: JSON.stringify(input) }),
  listOpportunities: (scope: Scope) => request<Opportunity[]>(`/api/opportunities?scope=${scope}`),
  patchOpportunity: (id: string, patch: Partial<{ title: string; scores: Partial<Opportunity['scores']>; note: string }>) =>
    request<Opportunity>(`/api/opportunities/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // 转正提案 / 确认中心
  createProposal: (input: {
    action: Proposal['action']
    source_id: string
    title?: string
    description?: string
    milestones?: string[]
  }) => request<Proposal>('/api/proposals', { method: 'POST', body: JSON.stringify(input) }),
  listProposals: (status?: Proposal['status']) =>
    request<Proposal[]>(`/api/proposals${status ? `?status=${status}` : ''}`),
  approveProposal: (id: string) => request<Proposal>(`/api/proposals/${id}/approve`, { method: 'POST' }),
  rejectProposal: (id: string) => request<Proposal>(`/api/proposals/${id}/reject`, { method: 'POST' }),

  // 目标
  createGoal: (input: { title: string; scope: Scope; track: Track; description?: string; milestones?: string[] }) =>
    request<Goal>('/api/goals', { method: 'POST', body: JSON.stringify(input) }),
  listGoals: (scope: Scope) => request<Goal[]>(`/api/goals?scope=${scope}`),
  patchGoal: (id: string, patch: Partial<{ title: string; status: string; progress: number; milestones: string[]; description: string }>) =>
    request<Goal>(`/api/goals/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // 任务
  createTask: (input: { title: string; goal_id: string | null; track?: Track; scheduled_for?: string }) =>
    request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),
  listTasks: (scope: Scope, bucket: 'today' | 'week' | 'future' | 'done') =>
    request<Task[]>(`/api/tasks?scope=${scope}&bucket=${bucket}`),
  patchTask: (id: string, patch: Partial<{ status: string; scheduled_for: string | null; title: string }>) =>
    request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),

  // 今日
  getToday: (scope: Scope) => request<TodayData>(`/api/today?scope=${scope}`),

  // 晚间复盘
  createReview: (scope: Scope) => request<Review>('/api/reviews', { method: 'POST', body: JSON.stringify({ scope }) }),
  listReviews: () => request<Review[]>('/api/reviews'),
}
