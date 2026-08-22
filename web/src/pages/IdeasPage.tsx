import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useScope } from '../App'
import type { Idea } from '../types'

export default function IdeasPage() {
  const { scope } = useScope()
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [input, setInput] = useState('')
  const [track, setTrack] = useState<'growth' | 'maintenance'>('growth')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  async function load() {
    try {
      setIdeas(await api.listIdeas(scope))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
  }, [scope])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const content = input.trim()
    if (!content) return
    try {
      await api.createIdea({ content, scope, track })
      setInput('')
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // 想法→机会：走确认中心（Agent 只提案，用户批准后生效）
  async function promote(idea: Idea) {
    setMsg('')
    setError('')
    try {
      await api.createProposal({ action: 'promote_idea_to_opportunity', source_id: idea.id })
      setMsg('已提交转正提案，去确认中心批准后生效')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="page">
      <h2 className="page-title">想法收件箱</h2>

      <form className="capture-box" onSubmit={add}>
        <input
          aria-label="新想法"
          placeholder="记一个想法…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <select
          aria-label="轨道"
          value={track}
          onChange={(e) => setTrack(e.target.value as 'growth' | 'maintenance')}
        >
          <option value="growth">成长</option>
          <option value="maintenance">维护</option>
        </select>
        <button type="submit" disabled={!input.trim()}>
          记下
        </button>
      </form>

      {ideas.length === 0 && <p className="empty-hint">还没有想法，先记一条试试。</p>}

      <ul className="plain-list">
        {ideas.map((idea) => (
          <li key={idea.id} className={idea.scope === 'family' ? 'family-label' : ''}>
            <span className="idea-content">{idea.content}</span>
            <span className="tags">
              <em className="tag">{idea.scope === 'family' ? '家庭' : '个人'}</em>
              <em className="tag">{idea.track === 'maintenance' ? '维护' : '成长'}</em>
              {idea.promoted_to_id ? (
                <em className="tag tag-status-candidate">已转正</em>
              ) : (
                <button
                  type="button"
                  className="btn tiny"
                  aria-label={`转正：${idea.content}`}
                  onClick={() => promote(idea)}
                >
                  转正
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {msg && <p className="ok">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
