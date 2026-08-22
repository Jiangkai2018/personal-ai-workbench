// 支付宝交易明细 CSV 解析：GBK 编码，前 24 行导出信息，表头 12+1 列。
// 收/支 ∈ 收入/支出/不计收支；只保留收入/支出且状态成功。
import type { BillRow } from '../types'

const OK_STATUS = /成功|已收钱|已转账|还款成功/

export interface AlipayParseResult {
  rows: BillRow[]
  /** 导出账户主人姓名（支付宝整账单归属于此人） */
  ownerName: string
  skipped: number
}

/** CSV 单行切分：支持引号包裹（商品说明常含逗号）与转义引号 */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQuote = false
      } else cur += ch
    } else if (ch === '"') {
      inQuote = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out.map((s) => s.replace(/\t+$/, '').trim()) // 订单号常带尾部制表符
}

export function parseAlipayCsv(buffer: Buffer): AlipayParseResult {
  // 支付宝官方导出为 GBK；兼容 UTF-8（自动识别，两者"交易时间"的字节序列不同）
  const gbkText = new TextDecoder('gbk').decode(buffer)
  const utf8Text = buffer.toString('utf8')
  const isUtf8 = utf8Text.includes('交易时间')
  const text = isUtf8 ? utf8Text : gbkText
  const lines = text.split(/\r?\n/)

  // 前置说明区找表头（以 交易时间, 开头）
  const headerIdx = lines.findIndex((l) => l.startsWith('交易时间,'))
  if (headerIdx < 0) throw new Error('未找到支付宝账单表头（可能不是支付宝的交易明细文件）')

  // 账户主人：姓名：李冰雪
  let ownerName = ''
  for (const l of lines.slice(0, headerIdx)) {
    const m = l.match(/姓名：?(.+?)(\s|$)/)
    if (m) ownerName = m[1].trim()
  }

  const rows: BillRow[] = []
  let skipped = 0
  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) continue
    // 表尾统计块以 ---- 或中文文字开头
    if (!/^\d{4}-\d{2}-\d{2}/.test(line.trim())) continue

    const f = splitCsvLine(line)
    // 列序：0交易时间 1交易分类 2交易对方 3对方账号 4商品说明 5收/支 6金额 7收/付款方式 8交易状态 9交易订单号 10商家订单号 11备注 12(尾逗号空列)
    const time = f[0]
    const inOut = f[5]
    if (inOut !== '收入' && inOut !== '支出') {
      skipped++ // 不计收支（充值提现/账户转存）
      continue
    }
    const status = f[8] ?? ''
    if (!OK_STATUS.test(status)) {
      skipped++
      continue
    }
    const amount = Number((f[6] ?? '').replace(/[,¥\s]/g, ''))
    if (!Number.isFinite(amount) || amount === 0) {
      skipped++
      continue
    }
    const m = time.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/)
    rows.push({
      source: 'alipay',
      time: m ? new Date(`${m[1]}T${m[2]}+08:00`).toISOString() : new Date().toISOString(),
      type: inOut === '收入' ? 'income' : 'expense',
      amount,
      categorySource: (f[1] ?? '').trim() || '其他',
      counterparty: (f[2] ?? '').trim(),
      detail: (f[4] ?? '').trim(),
      payMethod: (f[7] ?? '').trim(),
      orderId: (f[9] ?? '').trim(),
      remark: (f[11] ?? '').trim(),
    })
  }
  return { rows, ownerName, skipped }
}
