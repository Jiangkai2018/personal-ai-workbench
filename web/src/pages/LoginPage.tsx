import { useState } from 'react'
import { api } from '../api/client'
import type { SessionUser } from '../types'

export default function LoginPage({ onLogin }: { onLogin: (u: SessionUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  // 忘记密码：家庭互证找回
  const [showReset, setShowReset] = useState(false)
  const [resetUser, setResetUser] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [familyUser, setFamilyUser] = useState('')
  const [familyPassword, setFamilyPassword] = useState('')
  const [resetMsg, setResetMsg] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      const user = await api.login(username.trim(), password)
      onLogin(user)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function doReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setResetMsg('')
    try {
      await api.resetPassword({
        username: resetUser.trim(),
        new_password: newPassword,
        family_username: familyUser.trim(),
        family_password: familyPassword,
      })
      setResetMsg('密码已重置，请用新密码登录')
      setShowReset(false)
      setUsername(resetUser.trim())
      setNewPassword('')
      setFamilyPassword('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="page login-page">
      <div className="login-brand">
        <span className="seal" aria-hidden="true">
          工
        </span>
        <h2 className="page-title">个人 AI 工作台</h2>
      </div>
      <p className="login-sub">
        想法 → 机会 → 目标 → 执行 → <b>复盘</b>，把闭环跑起来
      </p>

      {!showReset ? (
        <form className="card form" onSubmit={submit}>
          <label>
            用户名
            <input
              aria-label="用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="如 jk / family"
            />
          </label>
          <label>
            密码
            <input
              aria-label="密码"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <button type="submit" className="btn primary" disabled={!username.trim() || !password}>
            登录
          </button>
          <button type="button" className="btn link" onClick={() => setShowReset(true)}>
            忘记密码？家人互证找回
          </button>
        </form>
      ) : (
        <form className="card form" onSubmit={doReset}>
          <p className="muted">
            需要另一位家人的账号密码验证后才能重置。双方都忘记时联系管理员用 CLI 兜底。
          </p>
          <label>
            要重置的账号
            <input
              aria-label="要重置的账号"
              value={resetUser}
              onChange={(e) => setResetUser(e.target.value)}
              placeholder="如 jk"
            />
          </label>
          <label>
            新密码（至少 8 位）
            <input
              aria-label="新密码"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label>
            家人账号
            <input
              aria-label="家人账号"
              value={familyUser}
              onChange={(e) => setFamilyUser(e.target.value)}
              placeholder="如 family"
            />
          </label>
          <label>
            家人密码
            <input
              aria-label="家人密码"
              type="password"
              value={familyPassword}
              onChange={(e) => setFamilyPassword(e.target.value)}
            />
          </label>
          <button
            type="submit"
            className="btn primary"
            disabled={!resetUser.trim() || newPassword.length < 8 || !familyUser.trim() || !familyPassword}
          >
            验证并重置
          </button>
          <button type="button" className="btn link" onClick={() => setShowReset(false)}>
            ← 返回登录
          </button>
        </form>
      )}

      {resetMsg && <p className="ok">{resetMsg}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  )
}
