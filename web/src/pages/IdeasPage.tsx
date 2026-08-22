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

  // 正在编辑的想法 id + 草稿
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftTrack, setDraftTrack] = useState<'growth' | 'maintenance'>('growth')

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

  function startEdit(idea: Idea) {
    setMsg('')
    setError('')
    setEditingId(idea.id)
    setDraft(idea.content)
    setDraftTrack(idea.track)
  }

  async function saveEdit(idea: Idea) {
    const content = draft.trim()
    if (!content) return
    try {
      await api.patchIdea(idea.id, { content, track: draftTrack })
      setEditingId(null)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove(idea: Idea) {
    setMsg('')
    setError('')
    if (!window.confirm(`删除想法「${idea.content.slice(0, 30)}${idea.content.length > 30 ? '…' : ''}」？`)) return
    try {
      await api.deleteIdea(idea.id)
      load()
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
            {editingId === idea.id ? (
              // 编辑态：正文 + 轨道
              <form
                className="idea-edit"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveEdit(idea)
                }}
              >
                <textarea
                  aria-label="编辑想法内容"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={3}
                  autoFocus
                />
                <div className="idea-edit-row">
                  <select
                    aria-label="编辑轨道"
                    value={draftTrack}
                    onChange={(e) => setDraftTrack(e.target.value as 'growth' | 'maintenance')}
                  >
                    <option value="growth">成长</option>
                    <option value="maintenance">维护</option>
                  </select>
                  <span className="idea-edit-actions">
                    <button type="submit" className="btn tiny" disabled={!draft.trim()}>
                      保存
                    </button>
                    <button
                      type="button"
                      className="btn ghost tiny-cancel"
                      aria-label={`取消编辑：${idea.content}`}
                      onClick={() => setEditingId(null)}
                    >
                      取消
                    </button>
                  </span>
                </div>
              </form>
            ) : (
              <>
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
                  <button
                    type="button"
                    className="btn ghost"
                    aria-label={`编辑：${idea.content}`}
                    onClick={() => startEdit(idea)}
                  >
                    编辑
                  </button>
                  {!idea.promoted_to_id && (
                    <button
                      type="button"
                      className="btn ghost danger"
                      aria-label={`删除：${idea.content}`}
                      onClick={() => remove(idea)}
                    >
                      删除
                    </button>
                  )}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className="ok">{msg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
