// 随手记 Web 版私有 API 客户端 —— 对外系统调用的唯一出口。
// 实测结论：鉴权仅需 authorization + client-key + trading-entity（sign/nonce/timestamp 可省）。
// 所有私有 API 细节（路径、错误码）都收敛在这一个文件，上游变动只改这里。
import type { CredentialStore } from './credential'
import type { BillRow } from './types'

const BASE = 'https://yun.feidee.net'

/** 统一可读错误（路由层直接透传给前端） */
export class SsjError extends Error {
  /**
   * TOKEN_INVALID = 凭证失效（401，前端引导重新填入）
   * LIMIT = 接口限额（如批量写入每日 2 次；可降级单条）
   * UNAVAILABLE = 网络/服务/其他可重试错误
   */
  constructor(message: string, public readonly kind: 'TOKEN_INVALID' | 'UNAVAILABLE' | 'LIMIT' = 'UNAVAILABLE') {
    super(message)
  }
}

export interface SsjMember {
  id: string
  name: string
}

interface TxInput {
  type: 'income' | 'expense'
  amount: number
  timeMs: number
  categoryId: string
  accountId: string
  memberId: string
  remark: string
}

export class SuishoujiClient {
  constructor(
    private readonly creds: CredentialStore,
    /** 默认资金账户（微信/支付宝流水统一挂的随手记账户，见 04.账户接口） */
    private readonly defaultAccountId: string,
  ) {}

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const cred = await this.creds.resolve()
    if (!cred) {
      throw new SsjError('随手记凭证未配置：请在财务页填入 token，或在 .env 设置 WORKBENCH_SSJ_TOKEN', 'TOKEN_INVALID')
    }
    let res: Response
    try {
      res = await fetch(BASE + path, {
        ...init,
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${cred.token}`,
          'client-key': cred.clientKey,
          'trading-entity': cred.tradingEntity,
          referer: 'https://www.feidee.com/',
          ...(init.headers as Record<string, string>),
        },
        signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new SsjError('随手记服务无法连接，请稍后重试', 'UNAVAILABLE')
    }
    if (res.status === 401) {
      throw new SsjError('随手记凭证已失效：请在财务页重新填入 token', 'TOKEN_INVALID')
    }
    if (!res.ok) {
      let message = `随手记接口返回 ${res.status}`
      let code = ''
      try {
        const body = (await res.json()) as { message?: string; code?: string }
        code = body.code ?? ''
        if (body.message) message = `随手记接口错误：${body.message}`
      } catch {
        // 非 JSON 错误体
      }
      // 403「权限不足」(0x0611) 实测是批量写入触达每日限额的表现，不是凭证问题；
      // 标记为 LIMIT 让上层降级单条写入，而不是误导用户重填 token
      if (res.status === 403 || res.status === 429 || code === '0x0611') {
        throw new SsjError(`${message}（批量接口每日限额或权限限制，将降级为逐条写入）`, 'LIMIT')
      }
      throw new SsjError(message, 'UNAVAILABLE')
    }
    if (res.status === 204) return null
    return res.json()
  }

  /** 测试连接：拉成员列表（最轻的接口），返回 成员/账本元信息 */
  async testConnection(): Promise<{ ok: true; memberCount: number; sample: string }> {
    const body = (await this.call('/cab-config-ws/v2/account-book/members?operation_codes=R')) as {
      data?: SsjMember[]
    }
    const members = body.data ?? []
    return { ok: true, memberCount: members.length, sample: members.map((m) => m.name).slice(0, 3).join('、') }
  }

  /** 成员列表（含默认成员如"本人"） */
  async members(): Promise<SsjMember[]> {
    const body = (await this.call('/cab-config-ws/v2/account-book/members?operation_codes=R')) as {
      data?: SsjMember[]
    }
    return body.data ?? []
  }

  /**
   * 按月查流水（月报数据源）。
   * @param month 形如 202608
   */
  async listMonthTransactions(month: string, pageSize = 500): Promise<Record<string, unknown>[]> {
    const body = (await this.call('/cab-query-ws/v2/statistics/transactions', {
      method: 'POST',
      body: JSON.stringify({
        group_filter: { group_key: 'TIME_MONTH', group_id: month },
        query: {},
        sort: { order_by: 'DESC', sort_by: 'ACCOUNT_TIME' },
        page: { page_offset: 0, page_size: pageSize },
      }),
    })) as { data?: Record<string, unknown>[] }
    return body.data ?? []
  }

  /** 单条写入（不限次） */
  private async writeOne(t: TxInput): Promise<void> {
    await this.call(`/cab-accounting-ws/v2/account-book/transaction/${t.type === 'income' ? 'income' : 'expense'}`, {
      method: 'POST',
      body: JSON.stringify({
        business_type: t.type === 'income' ? 'Income' : 'Expense',
        account: { id: t.accountId },
        category: { id: t.categoryId },
        amount: t.amount.toFixed(2),
        remark: t.remark,
        transaction_time: t.timeMs,
        member: { id: t.memberId },
      }),
    })
  }

  /**
   * 单条写入（用户决策：弃用批量接口 —— 其每日 2 次限额太紧，且失败语义不清）。
   * 前端逐条调用并驱动进度条。
   * 备注取商品名（用户决策：支付宝商品说明比原始备注更见文知意；微信同理，原始备注常为"/"）。
   */
  async writeSingle(row: BillRow, meta: { categoryId: string; memberId: string }): Promise<void> {
    await this.writeOne({
      type: row.type,
      amount: row.amount,
      timeMs: new Date(row.time).getTime(),
      categoryId: meta.categoryId,
      accountId: this.defaultAccountId,
      memberId: meta.memberId,
      remark: row.detail || row.remark || row.categorySource,
    })
  }

  // 设计约定（用户要求）：产品功能不集成"删除流水"API —— 对家庭账本风险过高。
  // 误导入的纠正路径：随手记 App 手动删除；去重指纹库保证不会重复导入。
  // DELETE /cab-accounting-ws/v2/account-book/transactions 仅限开发验证阶段用 curl 手动调用，
  // 且只允许删除验证过程自己创建的测试流水，绝不动真实数据。
}
