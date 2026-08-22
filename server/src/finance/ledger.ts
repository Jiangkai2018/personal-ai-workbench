// 导入指纹库：sha1(source + orderId) 永久去重 + 导入历史。
// 双保险的另一半（远端最新流水时间）在路由层调用随手记客户端完成。
import matter from 'gray-matter'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function fingerprintOf(source: string, orderId: string): string {
  return createHash('sha1').update(`${source}:${orderId}`).digest('hex')
}

export interface ImportRecord {
  date: string
  source: 'wechat' | 'alipay'
  total: number
  written: number
  failed: number
}

export class ImportLedger {
  constructor(private readonly baseDir: string) {}

  private get file(): string {
    return path.join(this.baseDir, 'finance', 'imported.md')
  }

  private async readRaw(): Promise<{ fingerprints: Set<string>; records: ImportRecord[] }> {
    try {
      const parsed = matter(await readFile(this.file, 'utf8'))
      const fingerprints = new Set<string>((parsed.data.fingerprints as string[]) ?? [])
      const records = (parsed.data.records as ImportRecord[]) ?? []
      return { fingerprints, records }
    } catch {
      return { fingerprints: new Set(), records: [] }
    }
  }

  /** 已导入的指纹集合（去重判断） */
  async imported(): Promise<Set<string>> {
    return (await this.readRaw()).fingerprints
  }

  /** 导入历史（新的在前） */
  async history(): Promise<ImportRecord[]> {
    return (await this.readRaw()).records
  }

  /** 单条导入成功后：立即记指纹（中断后不重导） */
  async recordFingerprints(fingerprints: string[]): Promise<void> {
    if (fingerprints.length === 0) return
    const { fingerprints: existing, records } = await this.readRaw()
    const merged = [...new Set([...existing, ...fingerprints])]
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFile(
      this.file,
      matter.stringify('# 导入指纹库（自动维护，勿手改）', {
        fingerprints: merged,
        records,
      }),
      'utf8',
    )
  }

  /** 清除过期指纹（远端随手记已删除对应流水时调用 —— 远端为唯一事实源） */
  async forgetFingerprints(fingerprints: string[]): Promise<void> {
    if (fingerprints.length === 0) return
    const drop = new Set(fingerprints)
    const { fingerprints: existing, records } = await this.readRaw()
    const kept = [...existing].filter((f) => !drop.has(f))
    if (kept.length === existing.size) return
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFile(
      this.file,
      matter.stringify('# 导入指纹库（自动维护，勿手改）', {
        fingerprints: kept,
        records,
      }),
      'utf8',
    )
  }

  /** 一次导入会话结束：追加一条历史汇总 */
  async recordSession(record: Omit<ImportRecord, 'date'>): Promise<void> {
    const { fingerprints: existing, records } = await this.readRaw()
    const entry: ImportRecord = { ...record, date: new Date().toISOString() }
    await mkdir(path.dirname(this.file), { recursive: true })
    await writeFile(
      this.file,
      matter.stringify('# 导入指纹库（自动维护，勿手改）', {
        fingerprints: [...existing],
        records: [entry, ...records].slice(0, 200),
      }),
      'utf8',
    )
  }
}
