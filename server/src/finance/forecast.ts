// 财务推演：确定性公式（无 AI 参与计算，AI 只写解读 —— 数字必须可复现）。
// 月结余 = Σ月收入 − Σ月固定开支 − 月均弹性支出；逐月复利 accumulation_{n+1} = accumulation_n * (1 + r/12) + saving

export interface IncomeItem {
  name: string
  /** 月收入（元） */
  amount: number
}

export interface FixedExpenseItem {
  name: string
  /** 月固定开支（元） */
  amount: number
}

export interface FinanceProfile {
  incomes: IncomeItem[]
  fixedExpenses: FixedExpenseItem[]
  /** 月均弹性支出（餐饮/购物等非固定，元） */
  variableMonthly: number
  /** 当前积累（元） */
  initialSavings: number
  /** 年化收益率（%，如 3.5 表示 3.5%） */
  annualRatePct: number
  /** 推演年限 */
  years: number
}

export interface ForecastPoint {
  /** 第几年（0 = 现在） */
  year: number
  /** 年末积累（元，保留 2 位） */
  balance: number
  /** 该年累计投入的本金（初始 + 历年结余），区分收益贡献 */
  contributed: number
}

export interface Milestone {
  /** 目标金额（元） */
  target: number
  /** 达到目标的年数（null = 推演期内未达到） */
  reachedAtYear: number | null
}

export interface ForecastResult {
  monthlySaving: number
  points: ForecastPoint[]
  milestones: Milestone[]
  /** 推演期结束时的年化综合收益率（含新增结余的影响，%） */
  effectiveAnnualPct: number
}

/** 默认里程碑（可由调用方覆盖） */
export const DEFAULT_MILESTONES = [100_000, 500_000, 1_000_000, 2_000_000, 5_000_000]

export function runForecast(profile: FinanceProfile, targets: number[] = DEFAULT_MILESTONES): ForecastResult {
  const monthlyIncome = profile.incomes.reduce((a, i) => a + (Number.isFinite(i.amount) ? i.amount : 0), 0)
  const monthlyFixed = profile.fixedExpenses.reduce((a, e) => a + (Number.isFinite(e.amount) ? e.amount : 0), 0)
  const monthlySaving = round2(monthlyIncome - monthlyFixed - profile.variableMonthly)
  const r = profile.annualRatePct / 100 / 12
  const years = Math.max(1, Math.min(50, Math.round(profile.years)))

  const points: ForecastPoint[] = [
    { year: 0, balance: round2(profile.initialSavings), contributed: round2(profile.initialSavings) },
  ]
  let balance = profile.initialSavings
  let contributed = profile.initialSavings

  for (let y = 1; y <= years; y++) {
    for (let m = 0; m < 12; m++) {
      balance = balance * (1 + r) + monthlySaving
      contributed += monthlySaving
    }
    points.push({ year: y, balance: round2(balance), contributed: round2(contributed) })
  }

  const milestones: Milestone[] = targets.map((target) => ({
    target,
    reachedAtYear: points.find((p) => p.balance >= target)?.year ?? null,
  }))

  // 综合年化：(期末/期初含投入) 用内部收益率近似：等差现金流月复利的有效年化 ≈ CAGR of (balance-contributed growth)
  const totalGain = balance - contributed
  const effectiveAnnualPct =
    contributed > 0 ? round2((totalGain / contributed / years) * 100) : 0

  return { monthlySaving, points, milestones, effectiveAnnualPct }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
