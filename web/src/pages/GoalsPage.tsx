import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useScope } from '../App'
import type { Goal } from '../types'

export default function GoalsPage() {
  const { scope } = useScope()
  const [goals, setGoals] = useState<Goal[]>([])
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [milestones, setMilestones] = useState('')
  const [error, setError] = useState('')

  async function load() {
    try {
      setGoals(await api.listGoals(scope))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
  }, [scope])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      await api.createGoal({
        title: title.trim(),
        scope,
        track: 'growth',
        description: description.trim(),
        milestones: milestones
          .split(/[\n,，]/)
          .map((s) => s.trim())
          .filter(Boolean),
      })
      setTitle('')
      setDescription('')
      setMilestones('')
      setShowForm(false)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  // 进度滑块直接改文件（后写覆盖，git 兜底）
  async function setProgress(goal: Goal, progress: number) {
    const updated = await api.patchGoal(goal.id, { progress })
    setGoals((gs) => gs.map((g) => (g.id === updated.id ? updated : g)))
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2 className="page-title">目标</h2>
        <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? '收起' : '+ 新目标'}
        </button>
      </div>

      {showForm && (
        <form className="card form" onSubmit={create}>
          <label>
            标题 *
            <input
              aria-label="目标标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="承诺投入的方向"
            />
          </label>
          <label>
            描述
            <textarea
              aria-label="目标描述"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="为什么值得做"
            />
          </label>
          <label>
            里程碑（逗号或换行分隔）
            <textarea
              aria-label="里程碑"
              value={milestones}
              onChange={(e) => setMilestones(e.target.value)}
              placeholder="v0 闭环, v1 Agent"
            />
          </label>
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            创建目标
          </button>
        </form>
      )}

      {goals.length === 0 && <p className="empty-hint">还没有目标。从想法到机会，再承诺一个目标。</p>}

      <ul className="goal-list">
        {goals.map((g) => (
          <li key={g.id} className="card goal-card">
            <div className="goal-head">
              <h3 className={g.scope === 'family' ? 'family-label' : ''}>{g.title}</h3>
              <em className={`tag tag-status-${g.status}`}>{g.status}</em>
              {g.scope === 'family' ? <em className="tag tag-family">家庭</em> : null}
            </div>
            {g.content && <p className="goal-desc">{g.content}</p>}
            <div className="progress-row">
              <progress value={g.progress} max={100} aria-label={`进度 ${g.progress}%`} />
              <span className="pct">{g.progress}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={g.progress}
                aria-label="调整进度"
                onChange={(e) => setProgress(g, Number(e.target.value))}
              />
            </div>
            {g.milestones.length > 0 && (
              <ul className="milestone-list">
                {g.milestones.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
