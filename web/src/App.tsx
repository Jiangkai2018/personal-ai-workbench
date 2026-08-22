import { createContext, useContext, useEffect, useState } from 'react'
import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import TodayPage from './pages/TodayPage'
import IdeasPage from './pages/IdeasPage'
import OpportunitiesPage from './pages/OpportunitiesPage'
import GoalsPage from './pages/GoalsPage'
import TasksPage from './pages/TasksPage'
import ConfirmationsPage from './pages/ConfirmationsPage'
import ReviewsPage from './pages/ReviewsPage'
import LoginPage from './pages/LoginPage'
import { api } from './api/client'
import type { Scope, SessionUser } from './types'

const ScopeCtx = createContext<{ scope: Scope; setScope: (s: Scope) => void }>({
  scope: 'personal',
  setScope: () => {},
})
// eslint-disable-next-line react-refresh/only-export-components
export const useScope = () => useContext(ScopeCtx)

/* Dock 导航图标：1.7px 细线，随 currentColor 染色 */
function NavIcon({ name }: { name: string }) {
  const common = {
    className: 'nav-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }
  switch (name) {
    case 'today':
      return (
        <svg {...common}>
          <circle cx="12" cy="13" r="4" />
          <path d="M12 4.5v2M5.6 7.6l1.4 1.4M18.4 7.6L17 9M2.5 13H5M19 13h2.5" />
          <path d="M4.5 18.5c1.7 1.5 4.4 2.5 7.5 2.5s5.8-1 7.5-2.5" />
        </svg>
      )
    case 'ideas':
      return (
        <svg {...common}>
          <path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8L12 3.5z" />
          <path d="M18.5 16.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2z" />
        </svg>
      )
    case 'opportunities':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M15.6 8.4l-1.8 4.4-4.4 1.8 1.8-4.4 4.4-1.8z" />
        </svg>
      )
    case 'goals':
      return (
        <svg {...common}>
          <path d="M6 21V3.5" />
          <path d="M6 4.8c2.6-1.6 5.2-1.6 7.8 0s5.2 1.6 7.2.4v8c-2 1.2-4.6 1.2-7.2-.4s-5.2-1.6-7.8 0" />
        </svg>
      )
    case 'tasks':
      return (
        <svg {...common}>
          <path d="M3.5 6.3l1.3 1.3 2.3-2.5M3.5 12.3l1.3 1.3 2.3-2.5M3.5 18.3l1.3 1.3 2.3-2.5" />
          <path d="M11.5 6.5h9M11.5 12.5h9M11.5 18.5h9" />
        </svg>
      )
    case 'reviews':
      return (
        <svg {...common}>
          <path d="M20 14.8A8.6 8.6 0 1 1 9.2 4a6.9 6.9 0 0 0 10.8 10.8z" />
        </svg>
      )
    case 'confirmations':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="4.5" />
          <path d="M9 12.3l2.1 2.1 4-4.5" />
        </svg>
      )
    default:
      return null
  }
}

export default function App() {
  const location = useLocation()
  // 会话恢复：undefined=加载中，null=未登录，SessionUser=已登录
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined)
  const [scope, setScope] = useState<Scope>(() => {
    const saved = localStorage.getItem('workbench.scope')
    return saved === 'family' ? 'family' : 'personal'
  })
  useEffect(() => {
    localStorage.setItem('workbench.scope', scope)
  }, [scope])
  useEffect(() => {
    api.me().then((u) => setUser(u))
  }, [])

  // 首页"确认中心"角标：待确认提案数
  const [pendingCount, setPendingCount] = useState(0)
  useEffect(() => {
    if (!user) return
    let cancelled = false
    api.listProposals('pending').then((ps) => {
      if (!cancelled) setPendingCount(ps.length)
    })
    return () => {
      cancelled = true
    }
  }, [user, location.pathname])

  if (user === undefined) {
    return <div className="page loading-page">加载中…</div>
  }
  if (!user) {
    return <LoginPage onLogin={(u) => setUser(u)} />
  }

  return (
    <ScopeCtx.Provider value={{ scope, setScope }}>
      <div className="app">
        <header className="app-header">
          <div className="brand">
            <span className="seal" aria-hidden="true">
              工
            </span>
            <h1 className="app-title">个人 AI 工作台</h1>
          </div>
          <div className="scope-toggle" role="tablist" aria-label="范围切换">
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'personal'}
              className={`scope-btn${scope === 'personal' ? ' active' : ''}`}
              onClick={() => setScope('personal')}
            >
              个人
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={scope === 'family'}
              className={`scope-btn family${scope === 'family' ? ' active' : ''}`}
              onClick={() => setScope('family')}
            >
              家庭
            </button>
          </div>
          <div className="header-right">
            <span className="whoami">{user.name}</span>
            <button
              type="button"
              className="btn link"
              aria-label="退出登录"
              onClick={async () => {
                await api.logout()
                setUser(null)
              }}
            >
              退出
            </button>
          </div>
        </header>

        <main className="app-main">
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/ideas" element={<IdeasPage />} />
            <Route path="/opportunities" element={<OpportunitiesPage />} />
            <Route path="/goals" element={<GoalsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/confirmations" element={<ConfirmationsPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
          </Routes>
        </main>

        <nav className="bottom-nav" aria-label="主导航">
          <NavLink to="/" end>
            <NavIcon name="today" />
            今日
          </NavLink>
          <NavLink to="/ideas">
            <NavIcon name="ideas" />
            想法
          </NavLink>
          <NavLink to="/opportunities">
            <NavIcon name="opportunities" />
            机会
          </NavLink>
          <NavLink to="/goals">
            <NavIcon name="goals" />
            目标
          </NavLink>
          <NavLink to="/tasks">
            <NavIcon name="tasks" />
            任务
          </NavLink>
          <NavLink to="/reviews">
            <NavIcon name="reviews" />
            复盘
          </NavLink>
          <NavLink to="/confirmations">
            <NavIcon name="confirmations" />
            确认{pendingCount > 0 ? <span className="badge">{pendingCount}</span> : null}
          </NavLink>
        </nav>
      </div>
    </ScopeCtx.Provider>
  )
}
