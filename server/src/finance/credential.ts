// 随手记凭证管理：Web 填入（data/finance/credential.md）优先，.env 兜底。
// 凭证是敏感信息：data/ 已被 gitignore，绝不入库。
import matter from 'gray-matter'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface SsjCredential {
  /** Bearer token */
  token: string
  clientKey: string
  /** 账本 id（trading-entity） */
  tradingEntity: string
  /** 凭证来源 */
  source: 'web' | 'env'
  /** Web 填入时间 */
  updatedAt?: string
}

const ENV_CLIENT_KEY = 'PiVEoJM9OHFS8xFlnD3CuSrJgRgyVLwS'
const ENV_TRADING_ENTITY = '1060909181480255488'

/** Web 填入的凭证可覆盖的字段（token 必填，其余可空则用 env/默认） */
export interface CredentialInput {
  token: string
  clientKey?: string
  tradingEntity?: string
}

export class CredentialStore {
  constructor(private readonly baseDir: string) {}

  private get file(): string {
    return path.join(this.baseDir, 'finance', 'credential.md')
  }

  /** 读取生效凭证：Web 填入优先，否则 env（env 无 token 则返回 null） */
  async resolve(): Promise<SsjCredential | null> {
    let web: CredentialInput | null = null
    let updatedAt: string | undefined
    try {
      const parsed = matter(await readFile(this.file, 'utf8'))
      const token = String(parsed.data.token ?? '').trim()
      if (token) {
        web = {
          token,
          clientKey: String(parsed.data.client_key ?? '').trim() || undefined,
          tradingEntity: String(parsed.data.trading_entity ?? '').trim() || undefined,
        }
        updatedAt = parsed.data.updated_at ? String(parsed.data.updated_at) : undefined
      }
    } catch {
      // 文件不存在走 env
    }
    if (web) {
      return {
        token: web.token,
        clientKey: web.clientKey || process.env.WORKBENCH_SSJ_CLIENT_KEY || ENV_CLIENT_KEY,
        tradingEntity: web.tradingEntity || process.env.WORKBENCH_SSJ_TRADING_ENTITY || ENV_TRADING_ENTITY,
        source: 'web',
        updatedAt,
      }
    }
    const envToken = process.env.WORKBENCH_SSJ_TOKEN?.trim()
    if (!envToken) return null
    return {
      token: envToken,
      clientKey: process.env.WORKBENCH_SSJ_CLIENT_KEY || ENV_CLIENT_KEY,
      tradingEntity: process.env.WORKBENCH_SSJ_TRADING_ENTITY || ENV_TRADING_ENTITY,
      source: 'env',
    }
  }

  /** Web 填入/更新凭证（覆盖式写入） */
  async save(input: CredentialInput): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const front = {
      token: input.token.trim(),
      ...(input.clientKey?.trim() ? { client_key: input.clientKey.trim() } : {}),
      ...(input.tradingEntity?.trim() ? { trading_entity: input.tradingEntity.trim() } : {}),
      updated_at: new Date().toISOString(),
    }
    await writeFile(this.file, matter.stringify('随手记凭证（Web 填入，优先于 .env）', front), 'utf8')
  }

  /** 清除 Web 凭证，回落 env */
  async clear(): Promise<void> {
    await writeFile(this.file, matter.stringify('（已清除，使用 .env 凭证）', { token: '' }), 'utf8')
  }
}
