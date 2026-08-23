// 月度流水聚合：远端流水 → 图表数据（纯函数，便于单测）
import { ALL_CATEGORIES } from './categoryMap'

export interface MonthAggregate {
  month: string
  totalIncome: number
  totalExpense: number
  net: number
  /** 支出分类占比（降序） */
  byCategory: { name: string; amount: number }[]
  /** 成员支出（降序） */
  byMember: { name: string; amount: number }[]
  /** 按日支出（升序日期） */
  byDay: { day: string; amount: number }[]
  /** 环比：上月总支出与变化率（null = 上月无数据） */
  prev: { month: string | null; totalExpense: number | null; deltaPct: number | null }
  /** 交易笔数 */
  count: number
}

interface TxLike {
  amount?: string | number
  business_type?: string
  transaction_time?: string | number
  category?: { id?: string }
  member?: { id?: string; name?: string }
}

const categoryNameById = new Map(ALL_CATEGORIES.map((c) => [c.id, c.parent ? `${c.parent}·${c.name}` : c.name]))

function monthOf(t: TxLike): string {
  const d = new Date(Number(t.transaction_time))
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

function dayOf(t: TxLike): string {
  const ms = Number(t.transaction_time)
  const d = new Date(ms)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 汇总单月（month 形如 202608）；prevTx 传上月流水算环比 */
export function aggregateMonth(month: string, txs: TxLike[], prevTxs: TxLike[]): MonthAggregate {
  let totalIncome = 0
  let totalExpense = 0
  const catMap = new Map<string, number>()
  const memberMap = new Map<string, number>()
  const dayMap = new Map<string, number>()
  let count = 0

  for (const t of txs) {
    const amount = Number(t.amount)
    if (!Number.isFinite(amount) || amount === 0) continue
    const isIncome = t.business_type === 'Income'
    if (isIncome) totalIncome += amount
    else totalExpense += amount
    count++
    if (!isIncome) {
      const catName = (t.category?.id && categoryNameById.get(t.category.id)) || '未分类'
      catMap.set(catName, (catMap.get(catName) ?? 0) + amount)
      const mName = (t.member?.name ?? t.member?.id ?? '未知成员').trim()
      memberMap.set(mName, (memberMap.get(mName) ?? 0) + amount)
      const day = dayOf(t)
      dayMap.set(day, (dayMap.get(day) ?? 0) + amount)
    }
  }

  const prevMonth = shiftMonth(month, -1)
  // 远端对无数据月份可能回退返回其他月流水：只统计确实落在上月的
  const prevExpense = prevTxs.reduce((acc, t) => {
    const amount = Number(t.amount)
    if (monthOf(t) !== prevMonth) return acc
    return acc + (Number.isFinite(amount) && t.business_type !== 'Income' ? amount : 0)
  }, 0)
  const deltaPct = prevExpense > 0 ? ((totalExpense - prevExpense) / prevExpense) * 100 : null

  return {
    month,
    totalIncome: round2(totalIncome),
    totalExpense: round2(totalExpense),
    net: round2(totalIncome - totalExpense),
    byCategory: [...catMap.entries()]
      .map(([name, amount]) => ({ name, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    byMember: [...memberMap.entries()]
      .map(([name, amount]) => ({ name, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount),
    byDay: [...dayMap.entries()]
      .map(([day, amount]) => ({ day, amount: round2(amount) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    prev: { month: prevMonth, totalExpense: round2(prevExpense), deltaPct: deltaPct === null ? null : round2(deltaPct) },
    count,
  }
}

function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(4, 6)) - 1 + delta
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
