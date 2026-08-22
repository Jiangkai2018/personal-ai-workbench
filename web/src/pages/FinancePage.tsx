import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { PreviewRow } from '../types'

interface PreviewResponse {
  source: 'wechat' | 'alipay'
  owner: string
  skipped: number
  duplicates: { local: number; remote: number; batch: number }
  /** 远端已删除、将重新导入的行数 */
  resurrected?: number
  rows: PreviewRow[]
  aiError?: string
}

interface ImportRecord {
  date: string
  source: string
  total: number
  written: number
  failed: number
}

export default function FinancePage() {
  // ---- 凭证 ----
  const [cred, setCred] = useState<{ configured: boolean; source?: string; maskedToken?: string } | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [credMsg, setCredMsg] = useState('')
  const [credErr, setCredErr] = useState('')
  const [showCredForm, setShowCredForm] = useState(false)

  // ---- 上传与预览 ----
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  const [rows, setRows] = useState<PreviewRow[]>([])
  const [categories, setCategories] = useState<Record<string, { name: string; id: string }[]>>({})
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const cancelRef = useRef(false)
  const [result, setResult] = useState<{ written: number; failed: { detail: string; reason: string }[] } | null>(null)
  const [error, setError] = useState('')
  const [history, setHistory] = useState<ImportRecord[]>([])

  async function loadCred() {
    try {
      setCred(await api.getFinanceCredential())
    } catch {
      /* 静默 */
    }
  }
  async function loadHistory() {
    try {
      setHistory(await api.getFinanceImports())
    } catch {
      /* 静默 */
    }
  }
  useEffect(() => {
    loadCred()
    loadHistory()
    api.getFinanceCategories().then(setCategories).catch(() => {})
  }, [])

  async function saveToken() {
    setCredMsg('')
    setCredErr('')
    try {
      const res = await api.saveFinanceCredential(tokenInput.trim())
      setCredMsg(res.verified ? `已保存并验证通过（${res.memberCount} 位成员：${res.sample}）` : '已保存，但验证未通过')
      setTokenInput('')
      setShowCredForm(false)
      loadCred()
    } catch (e) {
      setCredErr((e as Error).message)
    }
  }

  async function testConnection() {
    setCredMsg('')
    setCredErr('')
    try {
      const res = await api.testFinanceCredential()
      setCredMsg(`连接正常（${res.memberCount} 位成员：${res.sample}）`)
    } catch (e) {
      setCredErr((e as Error).message)
      setShowCredForm(true)
    }
  }

  async function upload(file: File) {
    setError('')
    setResult(null)
    setPreview(null)
    setUploading(true)
    try {
      const buf = await file.arrayBuffer()
      const res = await api.previewBills(file.name, buf)
      setPreview(res)
      setRows(res.rows)
      loadHistory()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function commit() {
    if (!preview) return
    setError('')
    setResult(null)
    cancelRef.current = false
    setProgress({ done: 0, total: rows.length })

    const failed: { detail: string; reason: string }[] = []
    let written = 0
    let done = 0
    for (const r of rows) {
      if (cancelRef.current) break
      try {
        const res = await api.commitOneBill(
          {
            source: r.source,
            time: r.time,
            type: r.type,
            amount: r.amount,
            orderId: r.orderId,
            fingerprint: r.fingerprint,
            categoryId: r.categoryId,
            remark: r.remark,
            detail: r.detail,
            categorySource: r.categorySource,
          },
          preview.owner,
        )
        if (!res.skipped) written++
      } catch (e) {
        failed.push({ detail: `${r.time.slice(0, 16).replace('T', ' ')} ${r.detail.slice(0, 24)} ¥${r.amount}`, reason: (e as Error).message })
        // 凭证失效：继续循环只会条条失败，直接中断
        if ((e as Error).message.includes('凭证已失效')) {
          setError((e as Error).message)
          break
        }
      }
      done++
      setProgress({ done, total: rows.length })
    }

    setProgress(null)
    setResult({ written, failed })
    api.recordFinanceImport({ source: preview.source, total: rows.length, written, failed: failed.length }).catch(() => {})
    if (!cancelRef.current) {
      setPreview(null)
      setRows([])
    }
    loadHistory()
  }

  const dupTotal = preview ? preview.duplicates.local + preview.duplicates.remote + preview.duplicates.batch : 0

  return (
    <div className="page finance-page">
      <h2 className="page-title">财务</h2>

      {/* 凭证卡片 */}
      <section className="card finance-cred">
        <div className="finance-cred-head">
          <h3 className="card-title">随手记连接</h3>
          <div className="finance-cred-state">
            {cred?.configured ? (
              <>
                <em className="tag tag-status-active">已连接</em>
                <span className="pct">
                  {cred.source === 'web' ? 'Web 填入' : '.env'} · {cred.maskedToken}
                </span>
                <button type="button" className="btn ghost" onClick={testConnection}>
                  测试
                </button>
              </>
            ) : (
              <em className="tag tag-status-rejected">未配置</em>
            )}
          </div>
        </div>
        {(showCredForm || !cred?.configured) && (
          <div className="finance-cred-form">
            <input
              aria-label="随手记 token"
              type="password"
              placeholder="粘贴新抓包的 Bearer token（以填入的为准）"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
            />
            <button type="button" className="btn tiny" onClick={saveToken} disabled={tokenInput.trim().length < 10}>
              保存并验证
            </button>
          </div>
        )}
        {!showCredForm && cred?.configured && (
          <button type="button" className="btn link" onClick={() => setShowCredForm(true)}>
            更换 token
          </button>
        )}
        {credMsg && <p className="ok">{credMsg}</p>}
        {credErr && <p className="error">{credErr}</p>}
      </section>

      {/* 账单导入 */}
      <section className="card">
        <h3 className="card-title">账单导入</h3>
        <p className="muted">上传微信支付 xlsx 或支付宝 csv 账单 → AI 分类 → 预览确认后写入随手记。重复账单自动跳过。</p>
        <div className="finance-upload">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.csv"
            aria-label="账单文件"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) upload(f)
            }}
          />
          {uploading && (
            <span className="tag tag-status-pending">
              <span className="spin" aria-hidden="true" /> 解析与分类中…
            </span>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        {/* 预览结果 */}
        {preview && (
          <div className="finance-preview">
            <p className="finance-preview-summary">
              {preview.source === 'wechat' ? '微信' : '支付宝'} · 归属 {preview.owner === 'Kai' ? 'Kai' : preview.owner} ·
              待导入 <strong>{rows.length}</strong> 笔
              {preview.resurrected ? `（其中 ${preview.resurrected} 笔远端已删除、将重新导入）` : ''} · 重复跳过{' '}
              {dupTotal} 笔（远端已存在 {preview.duplicates.remote} / 本地已导 {preview.duplicates.local} / 批内{' '}
              {preview.duplicates.batch}）· 非收支/未成功 {preview.skipped} 笔
            </p>
            {preview.aiError && <p className="muted">⚠ {preview.aiError}（未命中行已用默认分类）</p>}
            {rows.length > 0 && (
              <>
                <div className="finance-table-wrap">
                  <table className="finance-table">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>收支</th>
                        <th>金额</th>
                        <th>对方/商品</th>
                        <th>随手记分类</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.fingerprint}>
                          <td className="mono">{r.time.slice(5, 16).replace('T', ' ')}</td>
                          <td>{r.type === 'income' ? '收' : '支'}</td>
                          <td className={'mono ' + (r.type === 'income' ? 'income' : 'expense')}>
                            {r.type === 'income' ? '+' : '-'}
                            {r.amount.toFixed(2)}
                          </td>
                          <td className="finance-detail">
                            {r.counterparty || r.detail || r.remark}
                            {r.classifiedBy === 'ai' && <em className="tag tag-ai">AI</em>}
                          </td>
                          <td>
                            <select
                              aria-label={`分类-${r.orderId}`}
                              value={r.categoryId}
                              onChange={(e) =>
                                setRows((rs) =>
                                  rs.map((x, j) =>
                                    j === i ? { ...x, categoryId: e.target.value } : x,
                                  ),
                                )
                              }
                            >
                              {Object.entries(categories).map(([parent, subs]) => (
                                <optgroup key={parent} label={parent}>
                                  {subs.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {progress ? (
                  <div className="finance-progress">
                    <div className="finance-progress-text">
                      逐条写入随手记… {progress.done}/{progress.total}（已完成 {Math.round((progress.done / progress.total) * 100)}%）
                    </div>
                    <div className="today-meter finance-progress-bar" aria-hidden="true">
                      <i style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                    </div>
                    <button type="button" className="btn" onClick={() => (cancelRef.current = true)}>
                      停止导入
                    </button>
                  </div>
                ) : (
                  <div className="finance-commit">
                    <button type="button" className="btn primary" onClick={commit}>
                      确认导入 {rows.length} 笔（逐条写入）
                    </button>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => {
                        setPreview(null)
                        setRows([])
                      }}
                    >
                      取消
                    </button>
                  </div>
                )}
              </>
            )}
            {rows.length === 0 && <p className="ok">没有需要导入的新账单（全部为重复或被过滤）。</p>}
          </div>
        )}

        {/* 导入结果 */}
        {result && (
          <div className="finance-result">
            <p className="ok">
              导入完成：成功写入 {result.written} 笔
              {result.failed.length > 0 ? `，失败 ${result.failed.length} 笔（可重新上传，已成功的会自动跳过）` : ''}。
            </p>
            {result.failed.length > 0 && (
              <ul className="finance-failed">
                {result.failed.map((f, i) => (
                  <li key={i}>
                    {f.detail} — {f.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 导入历史 */}
        {history.length > 0 && (
          <div className="finance-history">
            <h4 className="card-title">导入记录</h4>
            <ul className="plain-list compact">
              {history.slice(0, 5).map((h, i) => (
                <li key={i}>
                  <span className="mono">{h.date.slice(0, 16).replace('T', ' ')}</span>{' '}
                  {h.source === 'wechat' ? '微信' : '支付宝'} · 共 {h.total} 笔 · 成功 {h.written}
                  {h.failed > 0 ? ` · 失败 ${h.failed}` : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* M2/M3 占位 */}
      <section className="card">
        <h3 className="card-title">月度报告 · 财务推演</h3>
        <p className="muted">（下一迭代：月度消费可视化报告 + AI 财务建议；收支档案与积累曲线推演）</p>
      </section>
    </div>
  )
}
