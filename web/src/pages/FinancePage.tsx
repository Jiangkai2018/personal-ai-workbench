import { useEffect, useState } from 'react'
import { api } from '../api/client'
import ImportTab from './finance/ImportTab'
import MonthReportTab from './finance/MonthReportTab'
import ForecastTab from './finance/ForecastTab'

type Tab = 'import' | 'report' | 'forecast'

const TABS: { key: Tab; label: string }[] = [
  { key: 'import', label: '账单导入' },
  { key: 'report', label: '月度报告' },
  { key: 'forecast', label: '财务推演' },
]

export default function FinancePage() {
  const [tab, setTab] = useState<Tab>('import')

  // ---- 凭证 ----
  const [cred, setCred] = useState<{ configured: boolean; source?: string; maskedToken?: string } | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [credMsg, setCredMsg] = useState('')
  const [credErr, setCredErr] = useState('')
  const [showCredForm, setShowCredForm] = useState(false)

  async function loadCred() {
    try {
      setCred(await api.getFinanceCredential())
    } catch {
      /* 静默 */
    }
  }
  useEffect(() => {
    loadCred()
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

      {/* tab 切换 */}
      <div className="finance-tabs" role="tablist" aria-label="财务功能">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`finance-tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'import' && <ImportTab />}
      {tab === 'report' && <MonthReportTab />}
      {tab === 'forecast' && <ForecastTab />}
    </div>
  )
}
