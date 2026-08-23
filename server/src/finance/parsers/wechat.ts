// 微信支付账单 xlsx 解析：SheetJS 读取，跳过前置说明行，过滤中性交易/未成功。
// 结构（实测样本）：前 16 行为导出信息（含 微信昵称：[xxx]），表头 11 列。
import * as XLSX from 'xlsx'
import type { BillRow } from '../types'

/** 交易状态含这些关键词才认为成功（过滤"已全额退款/未支付/待确认"等） */
const OK_STATUS = /成功|已收钱|已转账|已还款|提现已到账/

/** 账单主人昵称（微信导出文件前置区的"微信昵称"）→ 由路由层按 env 配置解析成员归属 */

export interface WeChatParseResult {
  rows: BillRow[]
  /** 导出文件里的微信昵称（成员归属由路由层按 env 配置解析） */
  nickname: string
  /** 被过滤掉的行数（中性交易/未成功） */
  skipped: number
}

export function parseWeChatXlsx(buffer: Buffer): WeChatParseResult {
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false })
  if (!grid.length) throw new Error('微信账单文件为空')

  // 前置说明区：找表头行（含"交易时间"和"交易单号"）
  const headerIdx = grid.findIndex(
    (r) => Array.isArray(r) && r.includes('交易时间') && r.includes('交易单号'),
  )
  if (headerIdx < 0) throw new Error('未找到微信账单表头（可能不是微信支付的账单文件）')
  const header = grid[headerIdx] as string[]
  const col = (name: string) => header.indexOf(name)

  // 昵称在前置说明里：微信昵称：[Kai]
  let nickname = ''
  for (const r of grid.slice(0, headerIdx)) {
    const joined = (Array.isArray(r) ? r.join(' ') : '').trim()
    const m = joined.match(/微信昵称：?\[(.+?)\]/)
    if (m) nickname = m[1]
  }

  const rows: BillRow[] = []
  let skipped = 0
  for (const r of grid.slice(headerIdx + 1)) {
    if (!Array.isArray(r) || !r.length) continue
    const time = String(r[col('交易时间')] ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}/.test(time)) continue // 表尾统计/空行

    const inOut = String(r[col('收/支')] ?? '').trim()
    if (inOut !== '收入' && inOut !== '支出') {
      skipped++ // 中性交易（充值/零钱通等）不入账
      continue
    }
    const status = String(r[col('当前状态')] ?? '').trim()
    if (!OK_STATUS.test(status)) {
      skipped++ // 未成功/退款关闭
      continue
    }
    const amount = Number(String(r[col('金额(元)')] ?? '').replace(/[,¥\s]/g, ''))
    if (!Number.isFinite(amount) || amount === 0) {
      skipped++
      continue
    }
    rows.push({
      source: 'wechat',
      time: normalizeTime(time),
      type: inOut === '收入' ? 'income' : 'expense',
      amount,
      categorySource: String(r[col('交易类型')] ?? '').trim() || '其他',
      counterparty: String(r[col('交易对方')] ?? '').trim(),
      detail: String(r[col('商品')] ?? '').trim(),
      payMethod: String(r[col('支付方式')] ?? '').trim(),
      orderId: String(r[col('交易单号')] ?? '').trim(),
      remark: String(r[col('备注')] ?? '').trim(),
    })
  }
  return { rows, nickname, skipped }
}

/** 微信时间 2026-08-19 14:49:39 → ISO（按北京时间解析） */
function normalizeTime(s: string): string {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!m) return new Date().toISOString()
  const [, y, mo, d, h, mi, se] = m
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}+08:00`).toISOString()
}
