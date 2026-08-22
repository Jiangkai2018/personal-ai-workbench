// 财务模块路由：随手记凭证管理 + 账单上传预览/确认导入 + 导入历史。
// 安全设计：三层去重（本地指纹库 / 远端流水匹配 / 批内 orderId）防止重复记账；
// 不提供任何删除流水入口（见 suishouji.ts 尾注）。
import express, { Router } from 'express'
import type { Response } from 'express'
import { z } from 'zod'
import { CredentialStore } from '../../finance/credential'
import { SsjError, SuishoujiClient } from '../../finance/suishouji'
import { parseBillFile } from '../../finance/parsers'
import { classifyRows } from '../../finance/classify'
import { ImportLedger, fingerprintOf } from '../../finance/ledger'
import { ALL_CATEGORIES } from '../../finance/categoryMap'
import type { BillRow, PreviewRow } from '../../finance/types'

/** 微信昵称 Kai 对应随手记成员名；其余（含支付宝）一律归冰雪（随手记资料约定） */
const MEMBER_KAI = '15737199Xsw'
const MEMBER_ICE = '冰雪'
/** 随手记默认资金账户（04.账户接口抓包：微信零钱/支付宝对应的挂账账户） */
const DEFAULT_ACCOUNT_ID = '535767612671279194'

/** 账单文件上传：原始字节流（文件名走 x-file-name 头，避免 multipart 依赖） */
const rawUpload = express.raw({ type: '*/*', limit: '30mb' })

export function financeRouter(dataDir: string): Router {
  const router = Router()
  const creds = new CredentialStore(dataDir)
  const ssj = new SuishoujiClient(creds, DEFAULT_ACCOUNT_ID)
  const ledger = new ImportLedger(dataDir)

  // 统一把 SsjError 翻译成带 kind 的可读响应（前端据 kind 引导凭证重填）
  function ssjFail(res: Response, err: unknown): boolean {
    if (err instanceof SsjError) {
      res.status(err.kind === 'TOKEN_INVALID' ? 440 : 502).json({
        error: err.kind,
        message: err.message,
      })
      return true
    }
    return false
  }

  // ---- 凭证管理 ----

  router.get('/credential', async (_req, res) => {
    const cred = await creds.resolve()
    res.json(
      cred
        ? {
            configured: true,
            source: cred.source,
            maskedToken: cred.token.slice(0, 8) + '…' + cred.token.slice(-4),
            updatedAt: cred.updatedAt ?? null,
          }
        : { configured: false },
    )
  })

  const saveCredentialSchema = z.object({
    token: z.string().trim().min(10, 'token 不能为空'),
    clientKey: z.string().trim().optional(),
    tradingEntity: z.string().trim().optional(),
  })
  router.put('/credential', async (req, res, next) => {
    try {
      const parsed = saveCredentialSchema.parse(req.body)
      await creds.save(parsed)
      // 保存即验证：不通则前端提示但已保存（用户可能还没切换账本）
      try {
        const test = await ssj.testConnection()
        res.json({ ok: true, verified: true, memberCount: test.memberCount, sample: test.sample })
      } catch (err) {
        if (ssjFail(res, err)) return
        throw err
      }
    } catch (err) {
      next(err)
    }
  })

  router.delete('/credential', async (_req, res) => {
    await creds.clear()
    res.json({ ok: true })
  })

  router.post('/credential/test', async (req, res, next) => {
    try {
      const test = await ssj.testConnection()
      res.json(test)
    } catch (err) {
      if (ssjFail(res, err)) return
      next(err)
    }
  })

  // ---- 成员（预览时展示归属） ----

  router.get('/members', async (_req, res, next) => {
    try {
      res.json(await ssj.members())
    } catch (err) {
      if (ssjFail(res, err)) return
      next(err)
    }
  })

  // ---- 账单上传 → 预览 ----

  /** 远端流水匹配集：覆盖账单日期区间的每个月拉一遍，按 日+金额+收支 匹配 */
  async function remoteExisting(rows: BillRow[]): Promise<Set<string>> {
    const months = new Set<string>()
    for (const r of rows) {
      const d = new Date(r.time)
      months.add(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
    }
    const set = new Set<string>()
    for (const month of months) {
      try {
        const txs = await ssj.listMonthTransactions(month)
        for (const t of txs) {
          const time = Number(t.transaction_time)
          const amount = Number(t.amount)
          const type = t.business_type === 'Income' ? 'income' : 'expense'
          if (!Number.isFinite(time) || !Number.isFinite(amount)) continue
          const d = new Date(time)
          const key = `${d.getUTCFullYear()}-${d.getUTCDate()}-${type}-${amount.toFixed(2)}`
          set.add(key)
        }
      } catch {
        // 远端查询失败不阻塞预览（本地指纹仍生效），提交时会再次校验
      }
    }
    return set
  }

  const remoteKey = (r: BillRow) => {
    const d = new Date(r.time)
    return `${d.getUTCFullYear()}-${d.getUTCDate()}-${r.type}-${r.amount.toFixed(2)}`
  }

  router.post(
    '/bills/preview',
    rawUpload,
    async (req, res, next) => {
      try {
        const filename = decodeURIComponent(req.header('x-file-name') ?? 'bill')
        const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body as ArrayBuffer)
        let parsed: ReturnType<typeof parseBillFile>
        try {
          parsed = parseBillFile(filename, buffer)
        } catch (err) {
          // 解析失败是用户输入问题：400 + 可读信息（不走 500 通用处理）
          res.status(400).json({ error: 'INVALID_BILL_FILE', message: (err as Error).message })
          return
        }

        // 去重第一道：本地指纹
        const imported = await ledger.imported()
        // 去重第二道：远端流水匹配
        const remote = parsed.rows.length > 0 ? await remoteExisting(parsed.rows) : new Set<string>()

        const fresh: BillRow[] = []
        const seenInBatch = new Set<string>()
        let localDup = 0
        let remoteDup = 0
        let batchDup = 0
        for (const row of parsed.rows) {
          const fp = fingerprintOf(row.source, row.orderId)
          if (imported.has(fp)) {
            localDup++
            continue
          }
          if (remote.has(remoteKey(row))) {
            remoteDup++
            continue
          }
          if (seenInBatch.has(fp)) {
            batchDup++
            continue
          }
          seenInBatch.add(fp)
          fresh.push(row)
        }

        // 分类：规则 + AI 兜底
        const classified = await classifyRows(fresh)

        const rows: PreviewRow[] = classified.rows.map((c) => ({
          ...c.row,
          fingerprint: fingerprintOf(c.row.source, c.row.orderId),
          categoryId: c.categoryId,
          categoryName: c.categoryName,
          classifiedBy: c.classifiedBy,
        }))

        res.json({
          source: parsed.source,
          owner: parsed.owner,
          skipped: parsed.skipped,
          duplicates: { local: localDup, remote: remoteDup, batch: batchDup },
          rows,
          aiError: classified.aiError,
        })
      } catch (err) {
        next(err)
      }
    },
  )

  // ---- 确认导入 ----

  const commitSchema = z.object({
    rows: z
      .array(
        z.object({
          source: z.enum(['wechat', 'alipay']),
          time: z.string(),
          type: z.enum(['income', 'expense']),
          amount: z.number().positive(),
          orderId: z.string().min(1),
          fingerprint: z.string().min(8),
          categoryId: z.string().min(1),
          remark: z.string().max(500).optional().default(''),
          detail: z.string().optional().default(''),
          categorySource: z.string().optional().default(''),
        }),
      )
      .min(1, '没有要导入的账单'),
    owner: z.string().default(''),
  })

  router.post('/bills/commit', async (req, res, next) => {
    try {
      const parsed = commitSchema.parse(req.body)

      // 提交前再校验一次本地指纹（预览与提交之间可能已导入过）
      const imported = await ledger.imported()
      const rows = parsed.rows.filter((r) => !imported.has(r.fingerprint))

      // 成员解析：微信昵称 Kai → 本人，其余 → 冰雪
      const members = await ssj.members()
      const kaiId = members.find((m) => m.name === MEMBER_KAI)?.id
      const iceId = members.find((m) => m.name === MEMBER_ICE)?.id
      const memberId = parsed.owner === 'Kai' ? kaiId : iceId
      if (!memberId) {
        res.status(502).json({ error: 'MEMBER_NOT_FOUND', message: '随手记成员解析失败，请检查账本成员' })
        return
      }

      const billRows: BillRow[] = rows.map((r) => ({
        source: r.source,
        time: r.time,
        type: r.type,
        amount: r.amount,
        categorySource: r.categorySource,
        counterparty: '',
        detail: r.detail,
        payMethod: '',
        orderId: r.orderId,
        remark: r.remark,
      }))
      const result = await ssj.commit(
        billRows,
        rows.map((r) => ({ categoryId: r.categoryId, memberId })),
      )

      // 全部失败不记指纹；部分成功也记成功的？V0 简化：只记 未失败 行的指纹
      const failedSet = new Set(result.failed.map((f) => f.orderId))
      const okFps = rows.filter((r) => !failedSet.has(r.orderId)).map((r) => r.fingerprint)
      await ledger.record(okFps, {
        source: rows[0]?.source ?? 'wechat',
        total: rows.length,
        batchWritten: result.batchWritten,
        singleWritten: result.singleWritten,
        failed: result.failed.length,
      })

      res.json(result)
    } catch (err) {
      if (ssjFail(res, err)) return
      next(err)
    }
  })

  // ---- 导入历史 ----

  router.get('/imports', async (_req, res) => {
    res.json(await ledger.history())
  })

  // ---- 随手记分类清单（预览表格下拉用，按一级分组） ----

  router.get('/categories', (_req, res) => {
    const grouped: Record<string, { name: string; id: string }[]> = {}
    for (const c of ALL_CATEGORIES) {
      if (!c.parent) continue
      grouped[c.parent] = grouped[c.parent] ?? []
      grouped[c.parent].push({ name: c.name, id: c.id })
    }
    res.json(grouped)
  })

  return router
}
