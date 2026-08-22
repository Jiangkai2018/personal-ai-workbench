// 机会 5 维速评：各维 0-20 → 总分百分制，按阈值分档（设计方案第七节）
import type { OpportunityStatus } from './types'

export const SCORE_DIMS = ['value', 'feasible', 'window', 'fit', 'risk'] as const
export type ScoreDim = (typeof SCORE_DIMS)[number]

export type Scores = Record<ScoreDim, number>

/** 总分 = 5 维之和（0-100） */
export function scoreTotal(s: Partial<Scores>): number {
  return SCORE_DIMS.reduce((acc, k) => acc + (s[k] ?? 0), 0)
}

/** 分档：≥80 转正候选 / 60-79 观察池 / <60 归档 */
export function statusFor(total: number): OpportunityStatus {
  if (total >= 80) return 'candidate'
  if (total >= 60) return 'observing'
  return 'archived'
}
