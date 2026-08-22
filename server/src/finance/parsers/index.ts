// 账单解析入口：按文件名/内容特征自动识别微信 xlsx 或支付宝 csv
import { parseWeChatXlsx } from './wechat'
import { parseAlipayCsv } from './alipay'
import type { BillRow } from '../types'

export interface ParseResult {
  rows: BillRow[]
  /** 成员归属提示：微信昵称 / 支付宝账户主人 */
  owner: string
  source: 'wechat' | 'alipay'
  skipped: number
}

export function parseBillFile(filename: string, buffer: Buffer): ParseResult {
  const isXlsx =
    filename.toLowerCase().endsWith('.xlsx') ||
    (buffer.length > 1 && buffer[0] === 0x50 && buffer[1] === 0x4b) // ZIP 魔数（xlsx 即 zip）
  const isCsv = filename.toLowerCase().endsWith('.csv')

  if (isXlsx) {
    const r = parseWeChatXlsx(buffer)
    return { rows: r.rows, owner: r.nickname || 'Kai', source: 'wechat', skipped: r.skipped }
  }
  if (isCsv) {
    const r = parseAlipayCsv(buffer)
    return { rows: r.rows, owner: r.ownerName || '冰雪', source: 'alipay', skipped: r.skipped }
  }
  throw new Error('不支持的账单文件：请上传微信 xlsx 或支付宝 csv')
}
