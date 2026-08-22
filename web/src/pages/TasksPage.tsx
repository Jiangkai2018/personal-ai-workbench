import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useScope } from '../App'
import type { Goal, Task } from '../types'

const BUCKETS = [
  { key: 'today', label: '今天' },
  { key: 'week', label: '本周' },
  { key: 'future', label: '未来' },
  { key: 'done', label: '归档' },
] as const
type Bucket = (typeof BUCKETS)[number]['key']

export default function TasksPage() {
  const { scope } = useScope()
  const [bucket, setBucket] = useState<Bucket>('today')
  const [tasks, setTasks] = useState<Task[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [title, setTitle] = useState('')
  const [goalId, setGoalId] = useState('')
  const [scheduled, setScheduled] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    try {
      const [ts, gs] = await Promise.all([api.listTasks(scope, bucket), api.listGoals(scope)])
      setTasks(ts)
      setGoals(gs)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
  }, [scope, bucket])

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      await api.createTask({
        title: title.trim(),
        goal_id: goalId || null,
        scheduled_for: scheduled || undefined,
      })
      setTitle('')
      setGoalId('')
      setScheduled('')
      setShowForm(false)
      load()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function toggle(task: Task) {
    const next = task.status === 'done' ? 'todo' : 'done'
    await api.patchTask(task.id, { status: next })
    load()
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2 className="page-title">任务</h2>
        <button type="button" className="btn" onClick={() => setShowForm((v) => !v)}>
          {showForm ? '收起' : '+ 新任务'}
        </button>
      </div>

      <div className="bucket-tabs" role="tablist">
        {BUCKETS.map((b) => (
          <button
            key={b.key}
            type="button"
            role="tab"
            aria-selected={bucket === b.key}
            className={`bucket-tab${bucket === b.key ? ' active' : ''}`}
            onClick={() => setBucket(b.key)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {showForm && (
        <form className="card form" onSubmit={create}>
          <label>
            标题 *
            <input
              aria-label="任务标题"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="每天做的事"
            />
          </label>
          <label>
            挂靠目标
            <select aria-label="挂靠目标" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">（维护 · 不挂目标）</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            排期
            <input
              type="date"
              aria-label="排期"
              value={scheduled}
              onChange={(e) => setScheduled(e.target.value)}
            />
          </label>
          <button type="submit" className="btn primary" disabled={!title.trim()}>
            创建任务
          </button>
        </form>
      )}

      {tasks.length === 0 && <p className="empty-hint">这个分区还没有任务。</p>}

      <ul className={`task-list${bucket === 'done' ? ' done' : ''}`}>
        {tasks.map((t) => (
          <li
            key={t.id}
            className={`task-item${t.status === 'done' ? ' done-item' : ''}`}
          >
            <button
              type="button"
              className="check-btn"
              aria-label={`${t.status === 'done' ? '恢复' : '完成'}：${t.title}`}
              onClick={() => toggle(t)}
            >
              {t.status === 'done' ? '✓' : '○'}
            </button>
            <span className={t.status === 'done' ? 'strike' : ''}>
              {t.title}
              {t.scope === 'family' ? <em className="tag tag-family">家庭</em> : null}
              {t.scheduled_for ? <em className="tag">{t.scheduled_for}</em> : null}
            </span>
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
