import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import type { PreviewRow } from '../../types'

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

/** 账单导入 tab：上传 → 预览（分类可改/可移除）→ 逐条写入（进度条） */
export default function ImportTab() {
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

  async function loadHistory() {
    try {
      setHistory(await api.getFinanceImports())
    } catch {
      /* 静默 */
    }
  }
  useEffect(() => {
    loadHistory()
    api.getFinanceCategories().then(setCategories).catch(() => {})
  }, [])

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
        failed.push({
          detail: `${r.time.slice(0, 16).replace('T', ' ')} ${r.detail.slice(0, 24)} ¥${r.amount}`,
          reason: (e as Error).message,
        })
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
    <div className="finance-import">
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
                        <th aria-label="操作"></th>
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
                                  rs.map((x, j) => (j === i ? { ...x, categoryId: e.target.value } : x)),
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
                          <td>
                            <button
                              type="button"
                              className="row-remove"
                              aria-label={`移除：${r.detail || r.counterparty || r.orderId}`}
                              title="从本次导入中移除（不影响随手记）"
                              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {progress ? (
                  <div className="finance-progress">
                    <div className="finance-progress-text">
                      逐条写入随手记… {progress.done}/{progress.total}（已完成{' '}
                      {Math.round((progress.done / progress.total) * 100)}%）
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
    </div>
  )
}
