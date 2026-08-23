import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { CHART_COLORS, Chart } from '../../lib/chart'
import type { EChartsCoreOption } from 'echarts/core'
import type { MonthAggregate, Report } from '../../types'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
}

export default function MonthReportTab() {
  const [month, setMonth] = useState(currentMonth())
  const [agg, setAgg] = useState<MonthAggregate | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load(m: string) {
    setLoading(true)
    setError('')
    try {
      setAgg(await api.getFinanceMonthData(m))
      // 已有该月报告则展示入口
      const reports = await api.listReports()
      const found = reports
        .filter((r) => r.opportunity_id === `finance:${m}`)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
      setReport(found ?? null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    load(month)
  }, [month])

  // 报告生成中 → 每 5s 刷新状态
  useEffect(() => {
    if (report?.status !== 'running') return
    const timer = setInterval(async () => {
      const reports = await api.listReports().catch(() => [] as Report[])
      const fresh = reports
        .filter((r) => r.opportunity_id === `finance:${month}`)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]
      if (fresh) setReport(fresh)
    }, 5000)
    return () => clearInterval(timer)
  }, [report?.status, month])

  async function generate() {
    setError('')
    try {
      setReport(await api.createFinanceMonthReport(month))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const buildPie = (a: MonthAggregate): EChartsCoreOption => ({
    color: CHART_COLORS,
    tooltip: { trigger: 'item', formatter: '{b}<br/>¥{c}（{d}%）' },
    series: [
      {
        type: 'pie',
        radius: ['38%', '68%'],
        center: ['50%', '50%'],
        itemStyle: { borderColor: '#fffdf8', borderWidth: 2, borderRadius: 4 },
        label: { color: '#5c574c', fontSize: 11 },
        data: a.byCategory.slice(0, 8).map((c) => ({ name: c.name, value: c.amount })),
      },
    ],
  })

  const buildBar = (a: MonthAggregate): EChartsCoreOption => ({
    color: [CHART_COLORS[2]],
    tooltip: { trigger: 'axis' },
    grid: { left: 44, right: 12, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: a.byDay.map((d) => d.day), axisLabel: { fontSize: 10, color: '#928c7e' } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#928c7e' }, splitLine: { lineStyle: { color: '#e5dfd0' } } },
    series: [{ type: 'bar', data: a.byDay.map((d) => d.amount), itemStyle: { borderRadius: [3, 3, 0, 0] } }],
  })

  const buildMember = (a: MonthAggregate): EChartsCoreOption => ({
    color: [CHART_COLORS[0]],
    tooltip: { trigger: 'axis' },
    grid: { left: 44, right: 12, top: 16, bottom: 24 },
    xAxis: { type: 'category', data: a.byMember.map((m) => m.name), axisLabel: { fontSize: 11, color: '#5c574c' } },
    yAxis: { type: 'value', axisLabel: { fontSize: 10, color: '#928c7e' }, splitLine: { lineStyle: { color: '#e5dfd0' } } },
    series: [{ type: 'bar', data: a.byMember.map((m) => m.amount), itemStyle: { borderRadius: [3, 3, 0, 0] } }],
  })

  return (
    <div className="finance-report">
      <div className="finance-month-picker">
        <input
          type="month"
          aria-label="选择月份"
          value={`${month.slice(0, 4)}-${month.slice(4)}`}
          onChange={(e) => {
            const v = e.target.value // 2026-08
            if (v) setMonth(v.replace('-', ''))
          }}
        />
        <button type="button" className="btn tiny" onClick={generate} disabled={report?.status === 'running'}>
          {report?.status === 'running' ? 'AI 建议生成中…' : '生成 AI 月报'}
        </button>
      </div>

      {loading && <p className="muted">拉取随手记流水中…</p>}
      {error && <p className="error">{error}</p>}

      {report && (
        <div className="finance-report-entry">
          {report.status === 'running' && (
            <span className="tag tag-status-pending">
              <span className="spin" aria-hidden="true" /> AI 建议生成中，完成可查看
            </span>
          )}
          {report.status === 'done' && (
            <Link to={`/reports/${report.id}`} className="btn tiny">
              查看 AI 月报
            </Link>
          )}
          {report.status === 'failed' && (
            <>
              <em className="tag tag-status-rejected" title={report.error}>
                月报生成失败
              </em>
              <button type="button" className="btn ghost" onClick={generate}>
                重试
              </button>
            </>
          )}
        </div>
      )}

      {agg && (
        <>
          <div className="finance-stats">
            <div className="stat">
              <span className="stat-label">支出</span>
              <span className="stat-value expense">¥{agg.totalExpense.toLocaleString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">收入</span>
              <span className="stat-value income">¥{agg.totalIncome.toLocaleString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">结余</span>
              <span className="stat-value">¥{agg.net.toLocaleString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">环比</span>
              <span className="stat-value">
                {agg.prev.deltaPct === null ? '—' : `${agg.prev.deltaPct > 0 ? '+' : ''}${agg.prev.deltaPct}%`}
              </span>
            </div>
          </div>

          <div className="card chart-card">
            <h3 className="card-title">支出分类（{agg.count} 笔）</h3>
            {agg.byCategory.length > 0 ? <Chart option={buildPie(agg)} height={280} /> : <p className="muted">本月无支出</p>}
          </div>
          <div className="card chart-card">
            <h3 className="card-title">按日支出</h3>
            {agg.byDay.length > 0 ? <Chart option={buildBar(agg)} height={220} /> : <p className="muted">无数据</p>}
          </div>
          <div className="card chart-card">
            <h3 className="card-title">成员支出</h3>
            {agg.byMember.length > 0 ? <Chart option={buildMember(agg)} height={200} /> : <p className="muted">无数据</p>}
          </div>
        </>
      )}
    </div>
  )
}
