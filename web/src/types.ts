// 与 server/src/domain/types.ts 对应的前端类型（SPA 侧保持解耦）

export type Scope = 'personal' | 'family'
export type Track = 'growth' | 'maintenance'

/** 当前登录用户（不含密码哈希） */
export interface SessionUser {
  username: string
  name: string
  family: boolean
}

export interface Entity {
  id: string
  type: string
  scope: Scope
  track: Track
  created_at: string
  content: string
}

export interface Idea extends Entity {
  type: 'idea'
  status: 'inbox'
  /** 转正成机会后回填 */
  promoted_to_id?: string
}

export interface Goal extends Entity {
  type: 'goal'
  title: string
  status: 'active' | 'paused' | 'done' | 'abandoned'
  progress: number
  milestones: string[]
}

export interface Task extends Entity {
  type: 'task'
  title: string
  goal_id: string | null
  status: 'todo' | 'done' | 'cancelled'
  scheduled_for?: string
  done_at?: string
}

export interface Opportunity extends Entity {
  type: 'opportunity'
  title: string
  scores: { value: number; feasible: number; window: number; fit: number; risk: number }
  total: number
  status: 'candidate' | 'observing' | 'archived'
  goal_id?: string
  source_idea_id?: string
  note?: string
  /** AI 初评标记：true = 当前分数来自 AI 初评（用户仍可调整覆盖） */
  ai_scored?: boolean
  ai_scored_at?: string
}

/** 领域分析报告：对机会的深度分析（异步长任务，content 即 markdown 报告） */
export interface Report extends Entity {
  type: 'report'
  status: 'running' | 'done' | 'failed'
  opportunity_id: string
  opportunity_title: string
  model: string
  started_at: string
  finished_at?: string
  error?: string
}

/** 晚间复盘：日小结 + 目标进度更新（按天+范围一份） */
export interface Review {
  id: string
  date: string
  scope: Scope
  completed: number
  goal_updates: { goal_id: string; title: string; from: number; to: number }[]
  summary: string
  content: string
  created_at: string
}

/** 财务：账单预览行（服务端 PreviewRow） */
export interface PreviewRow {
  source: 'wechat' | 'alipay'
  time: string
  type: 'income' | 'expense'
  amount: number
  categorySource: string
  counterparty: string
  detail: string
  payMethod: string
  orderId: string
  remark: string
  fingerprint: string
  categoryId: string
  categoryName: string
  classifiedBy: 'rule' | 'ai' | 'fallback'
}

/** 财务：月度聚合（图表数据） */
export interface MonthAggregate {
  month: string
  totalIncome: number
  totalExpense: number
  net: number
  byCategory: { name: string; amount: number }[]
  byMember: { name: string; amount: number }[]
  byDay: { day: string; amount: number }[]
  prev: { month: string | null; totalExpense: number | null; deltaPct: number | null }
  count: number
}

/** 财务：收支档案 */
export interface FinanceProfile {
  incomes: { name: string; amount: number }[]
  fixedExpenses: { name: string; amount: number }[]
  variableMonthly: number
  initialSavings: number
  annualRatePct: number
  years: number
}

/** 财务：推演结果 */
export interface ForecastResult {
  monthlySaving: number
  points: { year: number; balance: number; contributed: number }[]
  milestones: { target: number; reachedAtYear: number | null }[]
  effectiveAnnualPct: number
}

export interface TodayData {
  date: string
  scope: Scope
  items: Task[]
  done: Task[]
  activeGoals: Goal[]
}
