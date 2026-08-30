// 极简 fetch 封装：统一 JSON、错误解析为 zod 的 issues 第一条信息
import type { Scope, Track, Idea, Goal, Task, TodayData, SessionUser, Opportunity, Review, Report, PreviewRow, MonthAggregate, FinanceProfile, ForecastResult } from '../types'

// ── 知识库页面类型（0828-01）──
export interface KbEntry {
  path: string
  name: string
  type: 'dir' | 'file'
  size: number
  mtime: number
  binary: boolean
}
export interface KbFileData {
  path: string
  binary?: boolean
  content?: string
  mtime?: number
  size?: number
}
export interface KbTrashItem {
  path: string
  originalPath: string
  name: string
  size: number
  mtime: number
}
export interface KbAttachment {
  path: string
  name: string
  size: number
  mtime: number
}
export interface KbUploadResult {
  name: string
  ok: boolean
  draftPath?: string
  attachmentPath?: string
  error?: string
}

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
  patchIdea: (id: string, patch: Partial<{ content: string; scope: Scope; track: Track }>) =>
    request<Idea>(`/api/ideas/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteIdea: (id: string) => request<{ ok: boolean }>(`/api/ideas/${id}`, { method: 'DELETE' }),

  // 机会
  createOpportunity: (input: { title: string; scope: Scope; scores: Opportunity['scores']; note?: string }) =>
    request<Opportunity>('/api/opportunities', { method: 'POST', body: JSON.stringify(input) }),
  listOpportunities: (scope: Scope) => request<Opportunity[]>(`/api/opportunities?scope=${scope}`),
  patchOpportunity: (id: string, patch: Partial<{ title: string; scores: Partial<Opportunity['scores']>; note: string }>) =>
    request<Opportunity>(`/api/opportunities/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  /** AI 预评（不落盘）：新机会表单填初值 */
  aiPreviewOpportunity: (title: string, note?: string) =>
    request<{ scores: Opportunity['scores'] }>('/api/opportunities/ai-preview', {
      method: 'POST',
      body: JSON.stringify({ title, note }),
    }),
  /** AI 初评（落盘）：对已有机会打分 */
  aiScoreOpportunity: (id: string) =>
    request<Opportunity>(`/api/opportunities/${id}/ai-score`, { method: 'POST' }),
  /** 一键转正为目标 */
  promoteOpportunityToGoal: (id: string) =>
    request<Goal>(`/api/opportunities/${id}/promote-to-goal`, { method: 'POST' }),
  /** 发起领域分析（异步，返回 running 状态的报告） */
  analyzeOpportunity: (id: string) =>
    request<Report>(`/api/opportunities/${id}/analyze`, { method: 'POST' }),

  // 领域分析报告
  listReports: () => request<Report[]>('/api/reports'),
  getReport: (id: string) => request<Report>(`/api/reports/${id}`),

  // 想法一键转正为机会（服务端自动 AI 初评）
  promoteIdea: (id: string) =>
    request<Opportunity>(`/api/ideas/${id}/promote`, { method: 'POST' }),

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

  // 财务：随手记凭证
  getFinanceCredential: () =>
    request<{ configured: boolean; source?: string; maskedToken?: string; updatedAt?: string | null }>(
      '/api/finance/credential',
    ),
  saveFinanceCredential: (token: string) =>
    request<{ ok: boolean; verified: boolean; memberCount?: number; sample?: string }>(
      '/api/finance/credential',
      { method: 'PUT', body: JSON.stringify({ token }) },
    ),
  testFinanceCredential: () =>
    request<{ ok: boolean; memberCount: number; sample: string }>('/api/finance/credential/test', {
      method: 'POST',
    }),

  // 财务：账单导入
  previewBills: (filename: string, body: ArrayBuffer) =>
    request<{
      source: 'wechat' | 'alipay'
      owner: string
      skipped: number
      duplicates: { local: number; remote: number; batch: number }
      rows: PreviewRow[]
      aiError?: string
    }>(`/api/finance/bills/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(filename) },
      body: body as BodyInit,
    }),
  commitOneBill: (
    row: {
      source: string
      time: string
      type: 'income' | 'expense'
      amount: number
      orderId: string
      fingerprint: string
      categoryId: string
      remark?: string
      detail?: string
      categorySource?: string
    },
    owner: string,
  ) => request<{ ok: boolean; skipped: boolean }>('/api/finance/bills/commit-one', {
    method: 'POST',
    body: JSON.stringify({ row, owner }),
  }),
  recordFinanceImport: (summary: { source: 'wechat' | 'alipay'; total: number; written: number; failed: number }) =>
    request<{ ok: boolean }>('/api/finance/bills/record', {
      method: 'POST',
      body: JSON.stringify(summary),
    }),
  getFinanceImports: () =>
    request<{ date: string; source: string; total: number; written: number; failed: number }[]>(
      '/api/finance/imports',
    ),
  getFinanceCategories: () =>
    request<Record<string, { name: string; id: string }[]>>('/api/finance/categories'),

  // 财务：月度报告
  getFinanceMonthData: (month: string) =>
    request<MonthAggregate>(`/api/finance/month-data?month=${month}`),
  createFinanceMonthReport: (month: string) =>
    request<Report>('/api/finance/month-report', { method: 'POST', body: JSON.stringify({ month }) }),

  // 财务：收支档案与推演
  getFinanceProfile: () => request<FinanceProfile>('/api/finance/profile'),
  saveFinanceProfile: (profile: FinanceProfile & { note?: string }) =>
    request<FinanceProfile>('/api/finance/profile', { method: 'PUT', body: JSON.stringify(profile) }),
  getFinanceProfileVersions: () =>
    request<{ id: string; archivedAt: string; note: string; monthlySaving: number; finalBalance: number }[]>(
      '/api/finance/profile/versions',
    ),
  restoreFinanceProfile: (id: string) =>
    request<FinanceProfile>('/api/finance/profile/restore', { method: 'POST', body: JSON.stringify({ id }) }),
  getFinanceForecast: () => request<ForecastResult>('/api/finance/forecast'),
  explainFinanceForecast: () =>
    request<Report>('/api/finance/forecast/explain', { method: 'POST' }),

  // ── 知识库页面（0828-01）──
  kbTree: () => request<{ entries: KbEntry[] }>('/api/knowledge/tree'),
  kbFile: (path: string) => request<KbFileData>(`/api/knowledge/file?path=${encodeURIComponent(path)}`),
  kbSave: (path: string, content: string, expectedMtime?: number) =>
    request<{ ok: boolean; mtime: number }>('/api/knowledge/file', {
      method: 'PUT',
      body: JSON.stringify({ path, content, expectedMtime }),
    }),
  kbMkdir: (path: string) => request<{ ok: boolean }>('/api/knowledge/mkdir', { method: 'POST', body: JSON.stringify({ path }) }),
  kbRename: (from: string, to: string) =>
    request<{ ok: boolean }>('/api/knowledge/rename', { method: 'POST', body: JSON.stringify({ from, to }) }),
  kbDelete: (path: string) =>
    request<{ ok: boolean; trashedTo: string }>('/api/knowledge/delete', { method: 'POST', body: JSON.stringify({ path }) }),
  kbTrash: () => request<{ items: KbTrashItem[] }>('/api/knowledge/trash'),
  kbRestore: (path: string) =>
    request<{ ok: boolean; restoredTo: string }>('/api/knowledge/restore', { method: 'POST', body: JSON.stringify({ path }) }),
  kbPurge: (path: string) => request<{ ok: boolean }>(`/api/knowledge/purge?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  kbAttachments: () => request<{ items: KbAttachment[] }>('/api/knowledge/attachments'),
  kbDeleteAttachment: (path: string) =>
    request<{ ok: boolean; references: number }>(`/api/knowledge/attachment?path=${encodeURIComponent(path)}`, { method: 'DELETE' }),
  kbUpload: async (dir: string, files: File[]) => {
    const form = new FormData()
    if (dir) form.append('path', dir)
    for (const f of files) form.append('files', f)
    const res = await fetch('/api/knowledge/upload', { method: 'POST', body: form })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { message?: string; error?: string } | null
      throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
    }
    return res.json() as Promise<{ ok: boolean; results: KbUploadResult[] }>
  },
}
