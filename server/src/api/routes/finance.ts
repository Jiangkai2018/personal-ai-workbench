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
import { aggregateMonth } from '../../finance/aggregate'
import { runForecast, type FinanceProfile } from '../../finance/forecast'
import { aiChat } from '../../ai/chat'
import { AiError } from '../../ai/scoreClient'
import type { EntityStore } from '../../storage/repo'
import type { Report } from '../../domain/types'
import type { BillRow, PreviewRow } from '../../finance/types'

/** 微信昵称 Kai 对应随手记成员名；其余（含支付宝）一律归冰雪（随手记资料约定） */
const MEMBER_KAI = '15737199Xsw'
const MEMBER_ICE = '冰雪'
/** 随手记默认资金账户（04.账户接口抓包：微信零钱/支付宝对应的挂账账户） */
const DEFAULT_ACCOUNT_ID = '535767612671279194'

/** 账单文件上传：原始字节流（文件名走 x-file-name 头，避免 multipart 依赖） */
const rawUpload = express.raw({ type: '*/*', limit: '30mb' })

export function financeRouter(dataDir: string, store: EntityStore): Router {
  const router = Router()
  const creds = new CredentialStore(dataDir)
  const ssj = new SuishoujiClient(creds, DEFAULT_ACCOUNT_ID)
  const ledger = new ImportLedger(dataDir)

  /** 拉整月流水（分页循环，500/页） */
  async function allMonthTxs(month: string): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = []
    for (let offset = 0; offset < 100; offset++) {
      const page = await ssj.listMonthTransactionsRaw(month, 500, offset)
      out.push(...page)
      if (page.length < 500) break
    }
    return out
  }

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
    token: z
      .string()
      .trim()
      .min(10, 'token 不能为空')
      // 容错：整段复制 "Bearer xxx" 时剥掉前缀，避免拼出 "Bearer Bearer xxx"
      .transform((v) => v.replace(/^Bearer\s+/i, '')),
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

  // ---- 成员（预览时展示归属；进程内缓存 10 分钟，避免逐条导入时每行都查） ----

  let membersCache: { at: number; data: { id: string; name: string }[] } | null = null
  async function cachedMembers() {
    if (membersCache && Date.now() - membersCache.at < 10 * 60_000) return membersCache.data
    const data = await ssj.members()
    membersCache = { at: Date.now(), data }
    return data
  }

  router.get('/members', async (_req, res, next) => {
    try {
      res.json(await cachedMembers())
    } catch (err) {
      if (ssjFail(res, err)) return
      next(err)
    }
  })

  /** 按账单归属解析随手记成员 id（Kai → 本人，其余 → 冰雪） */
  async function resolveMemberId(owner: string): Promise<string | null> {
    const members = await cachedMembers()
    const kaiId = members.find((m) => m.name === MEMBER_KAI)?.id
    const iceId = members.find((m) => m.name === MEMBER_ICE)?.id
    return (owner === 'Kai' ? kaiId : iceId) ?? null
  }

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

        // 去重第一道：本地指纹 —— 但远端随手记是唯一事实源：
        // 命中指纹的行若远端已无对应流水（用户在随手记删除过），视为可重新导入并清除过期指纹
        const imported = await ledger.imported()
        // 去重第二道：远端流水匹配
        const remote = parsed.rows.length > 0 ? await remoteExisting(parsed.rows) : new Set<string>()

        const fresh: BillRow[] = []
        const seenInBatch = new Set<string>()
        const staleFps: string[] = []
        let localDup = 0
        let remoteDup = 0
        let batchDup = 0
        let resurrected = 0
        for (const row of parsed.rows) {
          const fp = fingerprintOf(row.source, row.orderId)
          if (imported.has(fp)) {
            if (remote.has(remoteKey(row))) {
              localDup++
              continue
            }
            // 远端已删除：清除过期指纹，允许重导
            staleFps.push(fp)
            resurrected++
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
        if (staleFps.length > 0) {
          await ledger.forgetFingerprints(staleFps)
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
          /** 远端已删除、本次将重新导入的行数（本地指纹已同步清除） */
          resurrected,
          rows,
          aiError: classified.aiError,
        })
      } catch (err) {
        next(err)
      }
    },
  )

  // ---- 确认导入（用户决策：弃用批量接口，前端逐条调用驱动进度条） ----

  const commitOneSchema = z.object({
    row: z.object({
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
    owner: z.string().default(''),
  })

  router.post('/bills/commit-one', async (req, res, next) => {
    try {
      const parsed = commitOneSchema.parse(req.body)
      const { row, owner } = parsed

      // 已导入过 → 幂等跳过（前端中断续传也安全）
      const imported = await ledger.imported()
      if (imported.has(row.fingerprint)) {
        res.json({ ok: true, skipped: true })
        return
      }

      const memberId = await resolveMemberId(owner)
      if (!memberId) {
        res.status(502).json({ error: 'MEMBER_NOT_FOUND', message: '随手记成员解析失败，请检查账本成员' })
        return
      }

      const billRow: BillRow = {
        source: row.source,
        time: row.time,
        type: row.type,
        amount: row.amount,
        categorySource: row.categorySource,
        counterparty: '',
        detail: row.detail,
        payMethod: '',
        orderId: row.orderId,
        remark: row.remark,
      }
      await ssj.writeSingle(billRow, { categoryId: row.categoryId, memberId })
      await ledger.recordFingerprints([row.fingerprint])
      res.json({ ok: true, skipped: false })
    } catch (err) {
      if (ssjFail(res, err)) return
      next(err)
    }
  })

  /** 一次导入会话结束：汇总一条历史 */
  const recordSessionSchema = z.object({
    source: z.enum(['wechat', 'alipay']),
    total: z.number().int().min(0),
    written: z.number().int().min(0),
    failed: z.number().int().min(0),
  })
  router.post('/bills/record', async (req, res, next) => {
    try {
      const parsed = recordSessionSchema.parse(req.body)
      await ledger.recordSession(parsed)
      res.json({ ok: true })
    } catch (err) {
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

  // ---- 月度报告（M2）：同步聚合数据 + 异步 AI 建议（复用报告实体与查看页） ----

  function prevMonthOf(month: string): string {
    const y = Number(month.slice(0, 4))
    const m = Number(month.slice(4, 6)) - 2
    const d = new Date(y, m + 1, 1)
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  const monthSchema = z.string().regex(/^\d{6}$/, 'month 形如 202608')

  /** 当月聚合数据（图表用，同步返回） */
  router.get('/month-data', async (req, res, next) => {
    try {
      const month = monthSchema.parse(req.query.month ?? '')
      const [txs, prevTxs] = await Promise.all([
        allMonthTxs(month),
        allMonthTxs(prevMonthOf(month)).catch(() => [] as Record<string, unknown>[]),
      ])
      res.json(aggregateMonth(month, txs, prevTxs))
    } catch (err) {
      if (ssjFail(res, err)) return
      next(err)
    }
  })

  /** 生成 AI 月报（异步任务，报告在 /reports/:id 查看） */
  const monthReportSchema = z.object({ month: monthSchema })
  router.post('/month-report', async (req, res, next) => {
    try {
      const { month } = monthReportSchema.parse(req.body)

      // 幂等：该月已有进行中的报告 → 直接返回；已结束的可重开（生成新报告）
      const existing = (await store.list('report')) as Report[]
      const running = existing.find(
        (r) => r.opportunity_id === `finance:${month}` && r.status === 'running',
      )
      if (running) {
        res.status(202).json(running)
        return
      }

      const report = await store.create({
        type: 'report',
        status: 'running',
        opportunity_id: `finance:${month}`,
        opportunity_title: `财务月报 ${month.slice(0, 4)}-${month.slice(4)}`,
        model: process.env.WORKBENCH_AI_MODEL || 'glm-5.3',
        scope: 'family',
        track: 'maintenance',
        body: '',
        started_at: new Date().toISOString(),
      })

      void (async () => {
        try {
          const txs = await allMonthTxs(month)
          const prevTxs = await allMonthTxs(prevMonthOf(month)).catch(() => [])
          const agg = aggregateMonth(month, txs, prevTxs)
          const advice = await aiChat(
            `你是一位务实家庭的财务顾问。基于给定月度消费数据写一份 markdown 报告（简体中文），
结构固定三节：## 消费概览解读、## 异常与亮点、## 下月建议。
要求：用数据说话、给可执行建议、不空话；月收入未必能从消费数据推出，不要臆测收入。
只输出 markdown 正文，不要表格。`,
            `月度消费数据（${month}）：\n${JSON.stringify(agg, null, 1)}`,
            2500,
          )
          const content = [
            `# 财务月报 ${month.slice(0, 4)}-${month.slice(4)}`,
            '',
            `> 支出 ¥${agg.totalExpense} · 收入 ¥${agg.totalIncome} · 结余 ¥${agg.net} · ${agg.count} 笔`,
            agg.prev.deltaPct !== null
              ? `> 环比上月 ${agg.prev.deltaPct > 0 ? '+' : ''}${agg.prev.deltaPct}%`
              : '> （上月无数据，环比省略）',
            '',
            advice,
          ].join('\n')
          await store.update(
            'report',
            report.id,
            { status: 'done', finished_at: new Date().toISOString() },
            content,
          )
        } catch (err) {
          await store.update('report', report.id, {
            status: 'failed',
            error: err instanceof AiError ? err.message : '生成失败',
            finished_at: new Date().toISOString(),
          })
        }
      })()

      res.status(202).json(report)
    } catch (err) {
      next(err)
    }
  })

  // ---- 收支档案与推演（M3） ----

  const profileSchema = z.object({
    incomes: z.array(z.object({ name: z.string().trim().min(1), amount: z.number().min(0) })),
    fixedExpenses: z.array(z.object({ name: z.string().trim().min(1), amount: z.number().min(0) })),
    variableMonthly: z.number().min(0).default(0),
    initialSavings: z.number().min(0).default(0),
    annualRatePct: z.number().min(0).max(30).default(3),
    years: z.number().int().min(1).max(50).default(10),
  })

  const PROFILE_ID = 'finance-profile'

  router.get('/profile', async (_req, res) => {
    const existing = (await store.get('profile', PROFILE_ID)) as (FinanceProfile & { id: string }) | null
    res.json(
      existing ?? {
        id: PROFILE_ID,
        incomes: [],
        fixedExpenses: [],
        variableMonthly: 0,
        initialSavings: 0,
        annualRatePct: 3,
        years: 10,
      },
    )
  })

  router.put('/profile', async (req, res, next) => {
    try {
      const parsed = profileSchema.parse(req.body)
      const existing = await store.get('profile', PROFILE_ID)
      const saved = existing
        ? await store.update('profile', PROFILE_ID, parsed as unknown as Record<string, unknown>)
        : await store.create({ type: 'profile', id: PROFILE_ID, ...parsed })
      res.json(saved)
    } catch (err) {
      next(err)
    }
  })

  /** 推演（确定性公式，无 AI） */
  router.get('/forecast', async (_req, res) => {
    const existing = (await store.get('profile', PROFILE_ID)) as (FinanceProfile & { id: string }) | null
    const profile: FinanceProfile = existing ?? {
      incomes: [],
      fixedExpenses: [],
      variableMonthly: 0,
      initialSavings: 0,
      annualRatePct: 3,
      years: 10,
    }
    res.json(runForecast(profile))
  })

  /** AI 解读推演结果（异步报告） */
  router.post('/forecast/explain', async (_req, res, next) => {
    try {
      const existing = (await store.get('profile', PROFILE_ID)) as (FinanceProfile & { id: string }) | null
      if (!existing) {
        res.status(400).json({ error: 'PROFILE_EMPTY', message: '请先填写收支档案' })
        return
      }
      const forecast = runForecast(existing)

      const report = await store.create({
        type: 'report',
        status: 'running',
        opportunity_id: 'finance:forecast',
        opportunity_title: '财务推演解读',
        model: process.env.WORKBENCH_AI_MODEL || 'glm-5.3',
        scope: 'family',
        track: 'maintenance',
        body: '',
        started_at: new Date().toISOString(),
      })

      void (async () => {
        try {
          const advice = await aiChat(
            `你是一位务实的家庭财务顾问。基于给定的收支档案与确定性推演结果，写 markdown 解读（简体中文）。
结构：## 推演结论、## 敏感性提示（哪些假设最影响结果）、## 可执行的改善杠杆（给 3 个具体动作）。
所有数字直接引用给定数据，不要自己另算。只输出 markdown 正文。`,
            `收支档案：${JSON.stringify({ ...existing, id: undefined }, null, 1)}\n\n推演结果：${JSON.stringify(forecast, null, 1)}`,
            2000,
          )
          await store.update(
            'report',
            report.id,
            { status: 'done', finished_at: new Date().toISOString() },
            `# 财务推演解读\n\n> 月结余 ¥${forecast.monthlySaving} · ${existing.years} 年后 ¥${forecast.points.at(-1)?.balance}\n\n${advice}`,
          )
        } catch (err) {
          await store.update('report', report.id, {
            status: 'failed',
            error: err instanceof AiError ? err.message : '生成失败',
            finished_at: new Date().toISOString(),
          })
        }
      })()

      res.status(202).json(report)
    } catch (err) {
      next(err)
    }
  })

  return router
}
