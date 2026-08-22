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
}

export interface Proposal extends Entity {
  type: 'proposal'
  action: 'promote_idea_to_opportunity' | 'promote_opportunity_to_goal'
  status: 'pending' | 'approved' | 'rejected'
  summary: string
  source_type: 'idea' | 'opportunity'
  source_id: string
  payload: Record<string, unknown>
  decided_at?: string
  decided_by?: string
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

export interface TodayData {
  date: string
  scope: Scope
  items: Task[]
  done: Task[]
  activeGoals: Goal[]
}
