import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { CHART_COLORS, Chart } from '../../lib/chart'
import type { EChartsCoreOption } from 'echarts/core'
import type { FinanceProfile, ForecastResult, Report } from '../../types'

const EMPTY: FinanceProfile = {
  incomes: [],
  fixedExpenses: [],
  variableMonthly: 0,
  initialSavings: 0,
  annualRatePct: 3,
  years: 10,
}

export default function ForecastTab() {
  const [profile, setProfile] = useState<FinanceProfile>(EMPTY)
  const [forecast, setForecast] = useState<ForecastResult | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')

  async function load() {
    try {
      setProfile({ ...EMPTY, ...(await api.getFinanceProfile()) })
    } catch {
      /* 静默 */
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function refreshForecast(p: FinanceProfile) {
    try {
      await api.saveFinanceProfile(p)
      setForecast(await api.getFinanceForecast())
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    refreshForecast(profile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setSaving(true)
    setMsg('')
    setError('')
    try {
      await api.saveFinanceProfile(profile)
      const f = await api.getFinanceForecast()
      setForecast(f)
      setMsg(`已保存 · 月结余 ¥${f.monthlySaving.toLocaleString()}`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function explain() {
    setError('')
    try {
      setReport(await api.explainFinanceForecast())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // 报告生成中轮询
  useEffect(() => {
    if (report?.status !== 'running') return
    const timer = setInterval(async () => {
      const fresh = (await api.listReports().catch(() => [] as Report[])).find(
        (r) => r.id === report.id,
      )
      if (fresh) setReport(fresh)
    }, 5000)
    return () => clearInterval(timer)
  }, [report?.status, report?.id])

  const buildLine = (f: ForecastResult): EChartsCoreOption => ({
    color: [CHART_COLORS[0], CHART_COLORS[2]],
    tooltip: { trigger: 'axis' },
    legend: { data: ['积累总额', '累计投入本金'], textStyle: { color: '#5c574c', fontSize: 11 }, top: 0 },
    grid: { left: 56, right: 16, top: 30, bottom: 26 },
    xAxis: { type: 'category', name: '年', data: f.points.map((p) => p.year), axisLabel: { fontSize: 10, color: '#928c7e' } },
    yAxis: {
      type: 'value',
      axisLabel: { fontSize: 10, color: '#928c7e', formatter: (v: number) => (v >= 10000 ? `${Math.round(v / 10000)}万` : String(v)) },
      splitLine: { lineStyle: { color: '#e5dfd0' } },
    },
    series: [
      {
        type: 'line',
        name: '积累总额',
        smooth: true,
        symbol: 'none',
        areaStyle: { opacity: 0.08 },
        data: f.points.map((p) => p.balance),
      },
      {
        type: 'line',
        name: '累计投入本金',
        smooth: true,
        symbol: 'none',
        lineStyle: { type: 'dashed' },
        data: f.points.map((p) => p.contributed),
      },
    ],
  })

  return (
    <div className="finance-forecast">
      <section className="card">
        <h3 className="card-title">收支档案（推演输入）</h3>

        <div className="profile-group">
          <h4>月收入</h4>
          {profile.incomes.map((it, i) => (
            <div key={i} className="profile-row">
              <input
                aria-label={`收入名${i}`}
                value={it.name}
                onChange={(e) =>
                  setProfile((p) => ({ ...p, incomes: p.incomes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) }))
                }
              />
              <input
                aria-label={`收入额${i}`}
                type="number"
                value={it.amount}
                onChange={(e) =>
                  setProfile((p) => ({
                    ...p,
                    incomes: p.incomes.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)),
                  }))
                }
              />
              <button
                type="button"
                className="row-remove"
                aria-label={`删除收入：${it.name}`}
                onClick={() => setProfile((p) => ({ ...p, incomes: p.incomes.filter((_, j) => j !== i) }))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost"
            onClick={() => setProfile((p) => ({ ...p, incomes: [...p.incomes, { name: '', amount: 0 }] }))}
          >
            + 加一笔收入
          </button>
        </div>

        <div className="profile-group">
          <h4>月固定开支</h4>
          {profile.fixedExpenses.map((it, i) => (
            <div key={i} className="profile-row">
              <input
                aria-label={`开支名${i}`}
                value={it.name}
                onChange={(e) =>
                  setProfile((p) => ({
                    ...p,
                    fixedExpenses: p.fixedExpenses.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  }))
                }
              />
              <input
                aria-label={`开支额${i}`}
                type="number"
                value={it.amount}
                onChange={(e) =>
                  setProfile((p) => ({
                    ...p,
                    fixedExpenses: p.fixedExpenses.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)),
                  }))
                }
              />
              <button
                type="button"
                className="row-remove"
                aria-label={`删除开支：${it.name}`}
                onClick={() => setProfile((p) => ({ ...p, fixedExpenses: p.fixedExpenses.filter((_, j) => j !== i) }))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost"
            onClick={() => setProfile((p) => ({ ...p, fixedExpenses: [...p.fixedExpenses, { name: '', amount: 0 }] }))}
          >
            + 加一笔固定开支
          </button>
        </div>

        <div className="profile-params">
          <label>
            月均弹性支出
            <input
              aria-label="月均弹性支出"
              type="number"
              value={profile.variableMonthly}
              onChange={(e) => setProfile((p) => ({ ...p, variableMonthly: Number(e.target.value) }))}
            />
          </label>
          <label>
            当前积累
            <input
              aria-label="当前积累"
              type="number"
              value={profile.initialSavings}
              onChange={(e) => setProfile((p) => ({ ...p, initialSavings: Number(e.target.value) }))}
            />
          </label>
          <label>
            年化收益率 %
            <input
              aria-label="年化收益率"
              type="number"
              step="0.1"
              value={profile.annualRatePct}
              onChange={(e) => setProfile((p) => ({ ...p, annualRatePct: Number(e.target.value) }))}
            />
          </label>
          <label>
            推演年限
            <input
              aria-label="推演年限"
              type="number"
              value={profile.years}
              onChange={(e) => setProfile((p) => ({ ...p, years: Number(e.target.value) }))}
            />
          </label>
        </div>

        <div className="finance-commit">
          <button type="button" className="btn primary" onClick={save} disabled={saving}>
            {saving ? '保存中…' : '保存并重算'}
          </button>
          <button type="button" className="btn" onClick={explain}>
            AI 解读
          </button>
        </div>
        {msg && <p className="ok">{msg}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {forecast && (
        <section className="card chart-card">
          <h3 className="card-title">
            积累曲线 · 月结余 ¥{forecast.monthlySaving.toLocaleString()}
            {forecast.monthlySaving > 0 ? '' : '（⚠ 结余 ≤ 0，曲线不增长）'}
          </h3>
          <Chart option={buildLine(forecast)} height={300} />
          <div className="milestones">
            {forecast.milestones.map((m) => (
              <span key={m.target} className={`tag ${m.reachedAtYear !== null ? 'tag-status-active' : ''}`}>
                {m.target >= 10000 ? `${m.target / 10000}万` : m.target}：
                {m.reachedAtYear === null ? '未达到' : `第 ${m.reachedAtYear} 年`}
              </span>
            ))}
          </div>
        </section>
      )}

      {report && (
        <div className="finance-report-entry">
          {report.status === 'running' && (
            <span className="tag tag-status-pending">
              <span className="spin" aria-hidden="true" /> AI 解读生成中
            </span>
          )}
          {report.status === 'done' && (
            <Link to={`/reports/${report.id}`} className="btn tiny">
              查看 AI 解读
            </Link>
          )}
          {report.status === 'failed' && (
            <em className="tag tag-status-rejected" title={report.error}>
              解读生成失败（可重试）
            </em>
          )}
        </div>
      )}
    </div>
  )
}
