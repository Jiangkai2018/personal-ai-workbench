// 领域模型 —— 对应 CONTEXT.md 的术语：想法/机会/目标/任务
// 每个实体是带 YAML frontmatter 的 .md 文件（ADR-0001：Markdown 即唯一数据源）

/** 范围：personal（个人私有）/ family（家庭共享） */
export type Scope = 'personal' | 'family'

/** 轨道：growth（成长，走完整漏斗）/ maintenance（维护，想法→任务直达） */
export type Track = 'growth' | 'maintenance'

/** 所有漏斗实体的公共 frontmatter 字段 */
export interface Entity {
  /** 形如 20260820-idea-3f9a：日期前缀 + 类型 + 短随机，可排序、可读 */
  id: string
  type: string
  scope: Scope
  track: Track
  created_at: string
  /** .md 文件正文（想法=内容；目标/任务=描述），统一走 content 字段 */
  content: string
  [key: string]: unknown
}

/** 想法：漏斗起点，捕获成本为零，不判断好坏 */
export type IdeaStatus = 'inbox'
export interface Idea extends Entity {
  type: 'idea'
  status: IdeaStatus
}

/** 目标：承诺投入的方向，带里程碑 + 验收标准 + 进度 */
export type GoalStatus = 'active' | 'paused' | 'done' | 'abandoned'
export interface Goal extends Entity {
  type: 'goal'
  title: string
  status: GoalStatus
  /** 0-100 进度 */
  progress: number
  milestones: string[]
}

/** 任务：必须挂在某个目标下（维护轨道允许直达），是"每天做的事" */
export type TaskStatus = 'todo' | 'done' | 'cancelled'
export interface Task extends Entity {
  type: 'task'
  title: string
  /** 挂靠的目标 id；maintenance 轨道可空 */
  goal_id: string | null
  status: TaskStatus
  /** 排期到某天（YYYY-MM-DD）。今天的任务进"今日 3 件事" */
  scheduled_for?: string
  done_at?: string
}

/** 机会：经 5 维速评、有方向性的外部可能性（漏斗中间环节） */
export type OpportunityStatus = 'candidate' | 'observing' | 'archived'
export interface Opportunity extends Entity {
  type: 'opportunity'
  title: string
  /** 5 维评分：价值度/可行度/时间窗/匹配度/风险度，各 0-20（风险度反向计分，越高越好） */
  scores: {
    value: number
    feasible: number
    window: number
    fit: number
    risk: number
  }
  /** 总分 0-100 = 5 维之和 */
  total: number
  status: OpportunityStatus
  /** 转正成目标后回填 goal_id */
  goal_id?: string
  /** 来源想法 id（想法→机会转正时回填） */
  source_idea_id?: string
  note?: string
  /** AI 初评标记：true = 当前分数来自 AI 初评（用户仍可调整覆盖） */
  ai_scored?: boolean
  ai_scored_at?: string
}

/** 领域分析报告：对机会的深度分析（异步长任务，正文即 markdown 报告） */
export type ReportStatus = 'running' | 'done' | 'failed'
export interface Report extends Entity {
  type: 'report'
  status: ReportStatus
  opportunity_id: string
  /** 冗余标题：报告查看页不依赖机会存在 */
  opportunity_title: string
  /** 实际使用的模型 */
  model: string
  started_at: string
  finished_at?: string
  /** 失败原因（status=failed 时） */
  error?: string
}

export type AnyEntity = Idea | Goal | Task | Opportunity | Report
