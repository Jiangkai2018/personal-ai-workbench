// 财务模块：解析器 / 分类规则 / 指纹库 / 凭证优先级（不触网）
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { parseBillFile } from '../src/finance/parsers'
import { parseAlipayCsv } from '../src/finance/parsers/alipay'
import { ruleLookup, findCategory, fallbackCategory } from '../src/finance/categoryMap'
import { classifyRows } from '../src/finance/classify'
import { ImportLedger, fingerprintOf } from '../src/finance/ledger'
import { CredentialStore } from '../src/finance/credential'

// ---- 工具：构造微信 xlsx（UTF-8 环境） ----
function buildWeChatXlsx(nickname: string, rows: (string | number)[][]): Buffer {
  const aoa: (string | number)[][] = [
    ['微信支付账单明细'],
    [`微信昵称：[${nickname}]`],
    ['起始时间：[2026-07-19 00:00:00] 终止时间：[2026-08-19 14:49:39]'],
    ['共87笔记录'],
    [],
    ['----------------------微信支付账单明细列表--------------------'],
    ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注'],
    ...rows,
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

const WECHAT_ROWS = [
  ['2026-08-18 10:06:28', '商户消费', '天客隆超市', '超市购物', '支出', 7.72, '零钱通', '支付成功', '4200003231wx01', '/', '/'],
  ['2026-08-17 20:00:00', '转账', 'Lover (冰雪)', '微信转账', '支出', 500.0, '零钱', '已转账', '4200003231wx02', '/', '转账备注'],
  ['2026-08-16 12:00:00', '商户消费', '美团', '外卖', '支出', 30.5, '零钱', '支付成功', '4200003231wx03', '/', '/'],
  ['2026-08-15 09:00:00', '商户消费', '某店', '充值', '/', 100.0, '零钱', '支付成功', '4200003231wx04', '/', '/'], // 中性：收/支=/
  ['2026-08-14 09:00:00', '商户消费', '某店', '失败单', '支出', 66.0, '零钱', '已全额退款', '4200003231wx05', '/', '/'], // 未成功
  ['2026-08-13 09:00:00', '二维码收款', '朋友', '收款', '收入', 88.8, '零钱', '已收钱', '4200003231wx06', '/', '/'],
]

describe('账单解析器', () => {
  it('微信 xlsx：识别昵称、过滤中性/未成功、列映射正确', () => {
    const buf = buildWeChatXlsx('Kai', WECHAT_ROWS)
    const r = parseBillFile('微信支付账单流水文件.xlsx', buf)
    expect(r.source).toBe('wechat')
    expect(r.owner).toBe('Kai')
    expect(r.rows).toHaveLength(4) // 6 行中过滤中性 + 退款
    expect(r.skipped).toBe(2)
    const first = r.rows[0]
    expect(first).toMatchObject({
      type: 'expense',
      amount: 7.72,
      categorySource: '商户消费',
      counterparty: '天客隆超市',
      orderId: '4200003231wx01',
      payMethod: '零钱通',
    })
    expect(r.rows[3]).toMatchObject({ type: 'income', amount: 88.8 })
  })

  it('支付宝 csv（UTF-8 兼容模式）：过滤不计收支/失败，字段正确', () => {
    const csv = [
      '------------------------------------------------------------------------------------',
      '导出信息：',
      '姓名：李冰雪',
      '支付宝账户：2623392734@qq.com',
      '------------------------支付宝支付科技有限公司  电子客户回单------------------------',
      '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注,',
      '2026-08-02 12:09:54,日用百货,拼多多平台商户,a@b.com,"先用后付,订单完结后自动付款",支出,24.85,农业银行信用卡(2003),支付成功,2026072423001cdp01,m01,,',
      '2026-08-01 18:52:44,日用百货,超市,zz@x.com,三元鲜牛奶,支出,0.99,余额宝,交易成功,2026073122001cdp02,m02,,',
      '2026-07-31 10:00:00,账户存取,余额宝,,转入余额宝,不计收支,1000.00,余额宝,交易成功,2026073122001cdp03,,,',
      '2026-07-30 10:00:00,餐饮美食,店,,面,收入,12.00,余额,交易成功,2026073022001cdp04,,,',
      '2026-07-29 10:00:00,餐饮美食,店,,失败,支出,5.00,余额,交易关闭,2026072922001cdp05,,,',
    ].join('\n')
    const r = parseAlipayCsv(Buffer.from(csv, 'utf8'))
    expect(r.ownerName).toBe('李冰雪')
    expect(r.rows).toHaveLength(3) // 过滤不计收支 + 关闭
    expect(r.skipped).toBe(2)
    // 引号内逗号正确解析
    expect(r.rows[0].detail).toContain('先用后付,订单完结后自动付款')
    expect(r.rows[0]).toMatchObject({ type: 'expense', amount: 24.85, categorySource: '日用百货', orderId: '2026072423001cdp01' })
    expect(r.rows[2]).toMatchObject({ type: 'income', amount: 12 })
  })

  it('不支持的文件类型报可读错误', () => {
    expect(() => parseBillFile('账单.pdf', Buffer.from('x'))).toThrow('不支持的账单文件')
  })
})

describe('分类：规则表 + 兜底', () => {
  it('支付宝官方分类命中同名镜像分类', () => {
    const hit = ruleLookup('餐饮美食', 'expense')
    expect(hit?.name).toBe('餐饮美食')
    expect(hit?.id).toBeTruthy()
    expect(ruleLookup('转账红包', 'expense')?.name).toBe('转账红包-支出')
    expect(ruleLookup('收入', 'income')?.name).toBe('其他收入')
  })

  it('微信转账 → 转账-支出；未知分类返回 null', () => {
    expect(ruleLookup('转账', 'expense')?.name).toBe('转账-支出')
    expect(ruleLookup('完全未知', 'expense')).toBeNull()
  })

  it('findCategory 支持父>子形式；fallback 永远有值', () => {
    expect(findCategory('食品酒水>外卖', 'expense')?.name).toBe('外卖')
    expect(fallbackCategory('expense').id).toBeTruthy()
    expect(fallbackCategory('income').id).toBeTruthy()
  })

  it('classifyRows：规则命中的行不依赖 AI（AI 未配置也能全部分类）', async () => {
    const rows = [
      {
        source: 'alipay' as const,
        time: '2026-08-01T10:00:00.000Z',
        type: 'expense' as const,
        amount: 24.85,
        categorySource: '日用百货',
        counterparty: '拼多多',
        detail: '先用后付',
        payMethod: '',
        orderId: 't1',
        remark: '',
      },
      {
        source: 'wechat' as const,
        time: '2026-08-01T11:00:00.000Z',
        type: 'expense' as const,
        amount: 500,
        categorySource: '转账',
        counterparty: 'Lover',
        detail: '微信转账',
        payMethod: '',
        orderId: 't2',
        remark: '',
      },
    ]
    const result = await classifyRows(rows)
    expect(result.rows[0].classifiedBy).toBe('rule')
    expect(result.rows[0].categoryName).toBe('日用百货')
    expect(result.rows[1].categoryName).toBe('转账-支出')
    expect(result.aiUsed).toBe(false)
  })
})

describe('导入指纹库', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'workbench-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('指纹入库后重复识别 + 历史倒序', async () => {
    const ledger = new ImportLedger(dir)
    const fp = fingerprintOf('alipay', 'order-1')
    expect(await ledger.imported()).toEqual(new Set())
    await ledger.record([fp], { source: 'alipay', total: 1, batchWritten: 1, singleWritten: 0, failed: 0 })
    expect((await ledger.imported()).has(fp)).toBe(true)
    await ledger.record([fingerprintOf('wechat', 'w1')], { source: 'wechat', total: 1, batchWritten: 1, singleWritten: 0, failed: 0 })
    const history = await ledger.history()
    expect(history).toHaveLength(2)
    expect(history[0].source).toBe('wechat') // 新的在前
  })
})

describe('随手记凭证优先级', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'workbench-'))
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })
  afterEach(() => {
    delete process.env.WORKBENCH_SSJ_TOKEN
  })

  it('无 Web 凭证时回落 env；Web 填入后以 Web 为准', async () => {
    const store = new CredentialStore(dir)
    expect(await store.resolve()).toBeNull()

    process.env.WORKBENCH_SSJ_TOKEN = 'env-token-1234567890'
    let cred = await store.resolve()
    expect(cred?.source).toBe('env')
    expect(cred?.token).toBe('env-token-1234567890')

    await store.save({ token: 'web-token-abcdefghij' })
    cred = await store.resolve()
    expect(cred?.source).toBe('web')
    expect(cred?.token).toBe('web-token-abcdefghij')

    await store.clear()
    cred = await store.resolve()
    expect(cred?.source).toBe('env')
  })
})
