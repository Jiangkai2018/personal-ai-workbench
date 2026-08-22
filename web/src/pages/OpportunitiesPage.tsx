import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useScope } from '../App'
import type { Opportunity } from '../types'

const DIMS: { key: keyof Opportunity['scores']; label: string; hint: string }[] = [
  { key: 'value', label: '价值度', hint: '天花板 + 复利' },
  { key: 'feasible', label: '可行度', hint: '现有技能/资源够得着' },
  { key: 'window', label: '时间窗', hint: '窗口期长短、东风已到' },
  { key: 'fit', label: '匹配度', hint: '与优势/当前目标一致' },
  { key: 'risk', label: '风险度', hint: '下行风险（反向计分）' },
]

const STATUS_TEXT: Record<Opportunity['status'], string> = {
  candidate: '转正候选',
  observing: '观察池',
  archived: '归档',
}

export default function OpportunitiesPage() {
  const { scope } = useScope()
  const [items, setItems] = useState<Opportunity[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [scores, setScores] = useState<Record<string, number>>({
    value: 0,
    feasible: 0,
    window: 0,
    fit: 0,
    risk: 0,
  })
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    try {
      setItems(await api.listOpportunities(scope))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
  }, [scope])

  const draftTotal = Object.values(scores).reduce((a, b) => a + b, 0)

  // 表单：AI 预评 —— 填初值，用户可再调整
  const [aiApplying, setAiApplying] = useState(false)
  const [aiApplied, setAiApplied] = useState(false)
  const [scoringId, setScoringId] = useState<string | null>(null)
  const [promotingId, setPromotingId] = useState<string | null>(null)

  async function aiPreview() {
    const t = title.trim()
    if (!t) return
    setError('')
    setAiApplying(true)
    try {
      const res = await api.aiPreviewOpportunity(t)
      setScores(res.scores)
      setAiApplied(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setAiApplying(false)
    }
  }

  // 机会→目标：一键直达转正
  async function promote(o: Opportunity) {
    setMsg('')
    setError('')
    setPromotingId(o.id)
    try {
      await api.promoteOpportunityToGoal(o.id)
      setMsg(`「${o.title}」已转正为目标`)
      load()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPromotingId(null)
    }
  }

  // 卡片：AI 初评（落盘）—— 对已有机会（如想法转来的 0 分项）补打/重打
  async function aiScore(o: Opportunity) {
    setError('')
    setMsg('')
    setScoringId(o.id)
    try {
      const updated = await api.aiScoreOpportunity(o.id)
      setItems((arr) => arr.map((x) => (x.id === updated.id ? updated : x)))
      setMsg(`AI 已完成「${o.title}」初评：${updated.total}/100，可拖动滑块调整`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setScoringId(null)
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      await api.createOpportunity({ title: title.trim(), scope, scores: scores as Opportunity['scores'] })
      setTitle('')
      setScores({ value: 0, feasible: 0, window: 0, fit: 0, risk: 0 })
      setAiApplied(false)
      setShowForm(false)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // 滑块直接 PATCH 评分 → 服务器重算总分与分档
  async function adjust(o: Opportunity, key: keyof Opportunity['scores'], value: number) {
    const updated = await api.patchOpportunity(o.id, { scores: { [key]: value } })
    setItems((arr) => arr.map((x) => (x.id === updated.id ? updated : x)))
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2 className="page-title">机会</h2>
        <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? '收起' : '+ 新机会'}
        </button>
      </div>

      {showForm && (
        <form className="card form" onSubmit={create}>
          <label>
            标题 *
            <input
              aria-label="机会标题"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setAiApplied(false)
              }}
              placeholder="外部可能性（副业/赛道/跳槽…）"
            />
          </label>

          <div className="ai-preview-row">
            <button
              type="button"
              className="btn tiny"
              onClick={aiPreview}
              disabled={!title.trim() || aiApplying}
            >
              {aiApplying ? 'AI 评估中…' : 'AI 预评'}
            </button>
            {aiApplied && (
              <span className="ai-hint">AI 初评已填入，可拖动滑块调整</span>
            )}
          </div>

          {DIMS.map((d) => (
            <label key={d.key}>
              {d.label} <em className="muted">（{d.hint}）</em>
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                aria-label={`评分-${d.label}`}
                value={scores[d.key]}
                onChange={(e) => setScores((s) => ({ ...s, [d.key]: Number(e.target.value) }))}
              />
              <span className="pct">{scores[d.key]}/20</span>
            </label>
          ))}

          <p className="score-line">
            速评总分：<strong>{draftTotal}</strong>/100
          </p>
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            创建机会
          </button>
        </form>
      )}

      {items.length === 0 && <p className="empty-hint">还没有机会。想法转正成机会，先来一轮 5 维速评。</p>}

      <ul className="goal-list">
        {items.map((o) => (
          <li key={o.id} className="card goal-card">
            <div className="goal-head">
              <h3 className={o.scope === 'family' ? 'family-label' : ''}>{o.title}</h3>
              <em className={`tag tag-status-${o.status}`}>{STATUS_TEXT[o.status]}</em>
              {o.scope === 'family' ? <em className="tag tag-family">家庭</em> : null}
            </div>

            <p className="score-line">
              总分 <strong>{o.total}</strong>/100
              {o.ai_scored ? <em className="tag tag-ai">AI 初评</em> : null}
              {o.source_idea_id ? <em className="tag">来自想法</em> : null}
              <button
                type="button"
                className="btn ghost"
                aria-label={`AI 初评：${o.title}`}
                onClick={() => aiScore(o)}
                disabled={scoringId === o.id}
              >
                {scoringId === o.id ? 'AI 初评中…' : o.ai_scored ? 'AI 重评' : 'AI 初评'}
              </button>
              {o.goal_id ? (
                <em className="tag tag-status-candidate">已转正为目标</em>
              ) : (
                <button
                  type="button"
                  className="btn tiny"
                  aria-label={`转正为目标：${o.title}`}
                  onClick={() => promote(o)}
                  disabled={promotingId === o.id}
                >
                  {promotingId === o.id ? '转正中…' : '转正为目标'}
                </button>
              )}
            </p>

            <div className="dim-grid">
              {DIMS.map((d) => (
                <label key={d.key} className="dim-item">
                  <span>
                    {d.label} <em className="pct">{o.scores[d.key]}/20</em>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    step={1}
                    aria-label={`调整-${d.label}-${o.title}`}
                    value={o.scores[d.key]}
                    onChange={(e) => adjust(o, d.key, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {msg && <p className="ok">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
