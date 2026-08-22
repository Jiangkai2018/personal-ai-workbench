// 财务模块领域类型：账单行（解析器的规范输出）与导入预览行

/** 账单来源 */
export type BillSource = 'wechat' | 'alipay'

/** 解析后的规范账单行 */
export interface BillRow {
  source: BillSource
  /** 交易时间（ISO 字符串） */
  time: string
  type: 'income' | 'expense'
  /** 金额（元） */
  amount: number
  /** 微信/支付宝的官方分类（原始） */
  categorySource: string
  /** 交易对方 */
  counterparty: string
  /** 商品说明/商品 */
  detail: string
  /** 支付方式 */
  payMethod: string
  /** 交易单号（全局唯一，去重主键） */
  orderId: string
  /** 备注 */
  remark: string
}

/** 去重后待预览的行：附指纹与分类结果 */
export interface PreviewRow extends BillRow {
  /** sha1(source + orderId) */
  fingerprint: string
  /** 随手记分类 ID（预览时可被用户改动） */
  categoryId: string
  /** 随手记分类名 */
  categoryName: string
  /** 分类来源：rule 规则表 | ai AI 兜底 | fallback 默认 */
  classifiedBy: 'rule' | 'ai' | 'fallback'
}

/** 写入随手记的结果 */
export interface CommitResult {
  total: number
  batchWritten: number
  singleWritten: number
  failed: { orderId: string; detail: string; reason: string }[]
}
