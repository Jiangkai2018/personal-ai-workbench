import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { useScope } from '../App'
import type { Task, TodayData } from '../types'

export default function TodayPage() {
  const { scope } = useScope()
  const [data, setData] = useState<TodayData | null>(null)
  const [capture, setCapture] = useState('')
  const [quickTask, setQuickTask] = useState('')
  const [goalId, setGoalId] = useState('')
  const [error, setError] = useState('')
  const [reviewMsg, setReviewMsg] = useState('')

  async function load() {
    try {
      setData(await api.getToday(scope))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    load()
  }, [scope])

  // 快捷捕获想法：回车即记，捕获成本为零
  async function submitCapture() {
    const content = capture.trim()
    if (!content) return
    try {
      await api.createIdea({ content, scope, track: 'growth' })
      setCapture('')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // 今日任务勾选
  async function checkTask(task: Task) {
    await api.patchTask(task.id, { status: 'done' })
    load()
  }
  async function uncheckTask(task: Task) {
    await api.patchTask(task.id, { status: 'todo' })
    load()
  }

  // 晚间复盘：汇总今日完成 + 更新目标进度（一天一次，幂等）
  async function runReview() {
    setReviewMsg('')
    setError('')
    try {
      const review = await api.createReview(scope)
      setReviewMsg(`${review.summary}，已写复盘`)
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // 加一件今天要做的事（挂活跃目标）
  async function addTodayTask() {
    const title = quickTask.trim()
    if (!title) return
    try {
      await api.createTask({
        title,
        goal_id: goalId || null,
        scheduled_for: data?.date,
      })
      setQuickTask('')
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (!data) {
    return <div className="page">{error || '加载中…'}</div>
  }

  const doneCount = data.done.length
  const totalCount = data.items.length + doneCount
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0

  return (
    <div className="page">
      <p className="date-line">{data.date} · {scope === 'family' ? '家庭' : '个人'}</p>

      {/* 快捷捕获框：首页 3 秒内完成"记一个想法" */}
      <form
        className="capture-box"
        onSubmit={(e) => {
          e.preventDefault()
          submitCapture()
        }}
      >
        <input
          aria-label="记录一个想法"
          placeholder="记一个想法…（不判断好坏）"
          value={capture}
          onChange={(e) => setCapture(e.target.value)}
        />
        <button type="submit" disabled={!capture.trim()}>
          记下
        </button>
      </form>

      {/* 今日 3 件事 */}
      <section className="card">
        <h2 className="card-title">
          今日要做的 {data.items.length ? `(${data.items.length})` : ''}
        </h2>

        {data.items.length === 0 && (
          <p className="empty-hint">今天还没有安排，加一件指向目标的事 ↓</p>
        )}

        <ul className="task-list">
          {data.items.map((t) => (
            <li key={t.id} className="task-item">
              <button
                type="button"
                className="check-btn"
                aria-label={`完成：${t.title}`}
                onClick={() => checkTask(t)}
              >
                ○
              </button>
              <span className={t.scope === 'family' ? 'family-label' : ''}>
                {t.title}
                {t.scope === 'family' ? <em className="tag tag-family">家庭</em> : null}
              </span>
            </li>
          ))}
        </ul>

        {/* 快速加今日任务 */}
        <form
          className="quick-add"
          onSubmit={(e) => {
            e.preventDefault()
            addTodayTask()
          }}
        >
          <input
            aria-label="快速添加今日任务"
            placeholder="+ 今天要做的"
            value={quickTask}
            onChange={(e) => setQuickTask(e.target.value)}
          />
          <select
            aria-label="选择目标"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
          >
            <option value="">（维护 · 不挂目标）</option>
            {data.activeGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!quickTask.trim()}>
            加
          </button>
        </form>
      </section>

      {/* 晚间复盘：汇总完成 + 更新目标进度 */}
      <button type="button" className="btn primary review-btn" onClick={runReview}>
        开始复盘
      </button>
      {reviewMsg && <p className="ok">{reviewMsg}</p>}

      {/* 今日完成 */}
      {doneCount > 0 && (
        <section className="card">
          <h2 className="card-title">
            今日完成 {doneCount}/{totalCount} <span className="pct">({pct}%)</span>
          </h2>
          <div className="today-meter" aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </div>
          <ul className="task-list done">
            {data.done.map((t) => (
              <li key={t.id} className="task-item done-item">
                <button
                  type="button"
                  className="check-btn"
                  aria-label={`恢复：${t.title}`}
                  onClick={() => uncheckTask(t)}
                >
                  ✓
                </button>
                <span className="strike">{t.title}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </div>
  )
}
