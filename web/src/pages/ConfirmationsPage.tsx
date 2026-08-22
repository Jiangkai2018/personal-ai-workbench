import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Proposal } from '../types'

const ACTION_TEXT: Record<Proposal['action'], string> = {
  promote_idea_to_opportunity: '想法 → 机会',
  promote_opportunity_to_goal: '机会 → 目标',
}
const STATUS_TEXT: Record<Proposal['status'], string> = {
  pending: '待确认',
  approved: '已批准',
  rejected: '已驳回',
}

export default function ConfirmationsPage() {
  const [items, setItems] = useState<Proposal[]>([])
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    try {
      setItems(await api.listProposals())
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function decide(p: Proposal, action: 'approve' | 'reject') {
    setError('')
    setMsg('')
    try {
      if (action === 'approve') {
        await api.approveProposal(p.id)
        setMsg('已批准，文件操作已执行')
      } else {
        await api.rejectProposal(p.id)
        setMsg('已驳回')
      }
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const pending = items.filter((p) => p.status === 'pending')
  const decided = items.filter((p) => p.status !== 'pending')

  return (
    <div className="page">
      <h2 className="page-title">确认中心</h2>
      <p className="muted">
        承诺类动作（想法→机会、机会→目标）Agent 只能提案，在这里批准后才生效。
      </p>

      {pending.length === 0 && <p className="empty-hint">没有待确认的提案。</p>}

      <ul className="plain-list">
        {pending.map((p) => (
          <li key={p.id} className="card proposal-item">
            <div className="goal-head">
              <em className="tag tag-status-pending">{ACTION_TEXT[p.action]}</em>
              <em className="tag">{STATUS_TEXT.pending}</em>
            </div>
            <p className="proposal-summary">{p.summary}</p>
            <div className="proposal-actions">
              <button type="button" className="btn primary" onClick={() => decide(p, 'approve')}>
                批准
              </button>
              <button type="button" className="btn" onClick={() => decide(p, 'reject')}>
                驳回
              </button>
            </div>
          </li>
        ))}
      </ul>

      {decided.length > 0 && (
        <>
          <h3 className="card-title">已处理</h3>
          <ul className="plain-list">
            {decided.map((p) => (
              <li key={p.id} className="proposal-item muted">
                <span className="proposal-summary">{p.summary}</span>
                <em className={`tag tag-status-${p.status}`}>
                  {STATUS_TEXT[p.status]} {p.decided_by ? `· ${p.decided_by}` : ''}
                </em>
              </li>
            ))}
          </ul>
        </>
      )}

      {msg && <p className="ok">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
