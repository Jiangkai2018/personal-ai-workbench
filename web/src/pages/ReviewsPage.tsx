import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Review } from '../types'

export default function ReviewsPage() {
  const [items, setItems] = useState<Review[]>([])
  const [error, setError] = useState('')

  async function load() {
    try {
      setItems(await api.listReviews())
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
  }, [])

  return (
    <div className="page">
      <h2 className="page-title">复盘时间线</h2>
      <p className="muted">每晚勾选今日完成项后点"开始复盘"，汇总执行并更新目标进度。</p>

      {items.length === 0 && <p className="empty-hint">还没有复盘。今晚在首页勾选完成项，然后点"开始复盘"。</p>}

      <ul className="plain-list">
        {items.map((r) => (
          <li key={r.id} className="card review-item">
            <div className="goal-head">
              <h3>{r.date}</h3>
              <em className="tag">{r.scope === 'family' ? '家庭' : '个人'}</em>
              <em className="tag">{r.summary}</em>
            </div>
            <pre className="review-body">{r.content}</pre>
            {r.goal_updates.length > 0 && (
              <div className="goal-updates">
                {r.goal_updates.map((u) => (
                  <span key={u.goal_id} className="tag">
                    {u.title}: {u.from}% → {u.to}%
                  </span>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
