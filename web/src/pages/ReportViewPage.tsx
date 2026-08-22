import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { renderMarkdown } from '../lib/markdown'
import type { Report } from '../types'

/** 领域分析报告查看页：running 时自动轮询，done 渲染 markdown */
export default function ReportViewPage() {
  const { id = '' } = useParams()
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const r = await api.getReport(id)
        if (!cancelled) {
          setReport(r)
          setError('')
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message)
      }
    }
    load()
    // 分析进行中每 5s 轮询一次
    const timer = setInterval(() => {
      if (!cancelled && report?.status === 'running') load()
    }, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [id, report?.status])

  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link to="/opportunities" className="btn link">
          ← 返回机会列表
        </Link>
      </div>
    )
  }
  if (!report) {
    return <div className="page">加载中…</div>
  }

  const minutes = report.finished_at
    ? Math.max(1, Math.round((new Date(report.finished_at).getTime() - new Date(report.started_at).getTime()) / 60000))
    : null

  return (
    <div className="page report-view">
      <div className="page-head">
        <h2 className="page-title">领域分析报告</h2>
        <Link to="/opportunities" className="btn link">
          ← 返回机会
        </Link>
      </div>

      <p className="report-meta">
        「{report.opportunity_title}」 · 模型 {report.model}
        {minutes ? ` · 用时约 ${minutes} 分钟` : ''}
        {report.status === 'running' && <em className="tag tag-status-pending">分析中…</em>}
        {report.status === 'failed' && <em className="tag tag-status-rejected">分析失败</em>}
      </p>

      {report.status === 'running' && (
        <div className="card">
          <p className="muted">
            深度分析通常需要 1–3 分钟（三段式：赛道与市场 → 同行格局 → 切入策略），完成后自动展示。
          </p>
          <div className="today-meter running" aria-hidden="true">
            <i className="indeterminate" />
          </div>
        </div>
      )}

      {report.status === 'failed' && (
        <div className="card">
          <p className="error">{report.error || '生成失败'}</p>
          <p className="muted">可在机会列表点「重新分析」重试。</p>
        </div>
      )}

      {report.status === 'done' && (
        <article className="card md-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(report.content) }} />
      )}
    </div>
  )
}
