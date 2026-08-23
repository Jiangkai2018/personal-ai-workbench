// 财务月度聚合 + 推演：纯函数单测（数字必须可复现）
import { describe, it, expect } from 'vitest'
import { aggregateMonth } from '../src/finance/aggregate'
import { runForecast, type FinanceProfile } from '../src/finance/forecast'

describe('月度聚合 aggregateMonth', () => {
  const tx = (over: Record<string, unknown>) => ({
    amount: '10.00',
    business_type: 'Expense',
    transaction_time: Date.UTC(2026, 7, 15, 6, 0, 0),
    category: { id: '535767612667085055' }, // 食品酒水>伙食费
    member: { name: '冰雪', id: 'm1' },
    ...over,
  })

  it('收支汇总 / 分类与成员归属 / 日趋势 / 环比', () => {
    const agg = aggregateMonth(
      '202608',
      [
        tx({}),
        tx({ amount: '24.85', transaction_time: Date.UTC(2026, 7, 2, 4, 0, 0) }),
        tx({ amount: '500', business_type: 'Income' }),
      ],
      [tx({ amount: '100', transaction_time: Date.UTC(2026, 6, 1) })],
    )
    expect(agg.totalExpense).toBe(34.85)
    expect(agg.totalIncome).toBe(500)
    expect(agg.net).toBe(465.15)
    expect(agg.count).toBe(3)
    // 分类名带父级前缀
    expect(agg.byCategory[0]).toEqual({ name: '食品酒水·伙食费', amount: 34.85 })
    expect(agg.byMember[0]).toEqual({ name: '冰雪', amount: 34.85 })
    // 日趋势按日期升序
    expect(agg.byDay.map((d) => d.day)).toEqual(['08-02', '08-15'])
    // 环比：上月支出 100 → 本月 34.85，-65.15%
    expect(agg.prev.totalExpense).toBe(100)
    expect(agg.prev.deltaPct).toBe(-65.15)
  })

  it('上月无数据时环比为 null；分类未知归未分类', () => {
    const agg = aggregateMonth('202608', [tx({ category: { id: 'nope' } })], [])
    expect(agg.prev.deltaPct).toBeNull()
    expect(agg.byCategory[0].name).toBe('未分类')
  })
})

describe('财务推演 runForecast（确定性公式）', () => {
  const base: FinanceProfile = {
    incomes: [{ name: '工资', amount: 10000 }],
    fixedExpenses: [{ name: '房贷', amount: 4000 }],
    variableMonthly: 3000,
    initialSavings: 50000,
    annualRatePct: 3,
    years: 10,
  }

  it('月结余 = 收入 − 固定 − 弹性', () => {
    const f = runForecast(base)
    expect(f.monthlySaving).toBe(3000)
    expect(f.points[0]).toEqual({ year: 0, balance: 50000, contributed: 50000 })
    expect(f.points).toHaveLength(11) // 0..10 年
    // 手工复核第 1 年：50000 逐月复利 + 每月 3000
    let bal = 50000
    for (let m = 0; m < 12; m++) bal = bal * (1 + 0.03 / 12) + 3000
    expect(f.points[1].balance).toBe(Math.round(bal * 100) / 100)
    expect(f.points[1].contributed).toBe(50000 + 36000)
  })

  it('里程碑：3 千/月 + 5 万起始，10 万应在 1-2 年内达到', () => {
    const f = runForecast(base, [100000, 5000000])
    const m100k = f.milestones.find((m) => m.target === 100000)
    expect(m100k?.reachedAtYear).toBeGreaterThanOrEqual(1)
    expect(m100k?.reachedAtYear).toBeLessThanOrEqual(2)
    // 500 万 10 年达不到
    expect(f.milestones.find((m) => m.target === 5000000)?.reachedAtYear).toBeNull()
  })

  it('零结余时曲线仍按复利增长初始积累', () => {
    const f = runForecast({ ...base, incomes: [{ name: '工资', amount: 7000 }] })
    expect(f.monthlySaving).toBe(0)
    expect(f.points[10].balance).toBeGreaterThan(f.points[0].balance)
    // 5 万 3% 月复利十年 = 50000 × (1.0025)^120 ≈ 67467.68
    expect(f.points[10].balance).toBeCloseTo(67467.68, -1)
  })
})
