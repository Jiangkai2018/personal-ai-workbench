// 上传解析管道单测（0828-01 §2）：md/txt 直接入树；pdf/docx/xlsx/csv → 解析稿（来源头、重名自动后缀）
// fixture 小样件在 test/fixtures/（python 生成：最小合法 PDF/DOCX + 1x1 PNG）。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

function fixture(name: string): Buffer {
  return readFileSync(path.join(import.meta.dirname, 'fixtures', name))
}

async function makeXlsx(sheets: Record<string, string[][]>): Promise<Buffer> {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

describe('上传解析管道', () => {
  let dataDir: string
  let kbRoot: string
  let app: ReturnType<typeof createApp>
  let agent: Awaited<ReturnType<typeof loginAgent>>
  const savedEnv: Array<[string, string | undefined]> = []

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-upload-'))
    kbRoot = path.join(dataDir, 'knowledge')
    await seedUsers(dataDir)
    app = createApp({ dataDir, jwtSecret: 'test-secret' })
    agent = await loginAgent(app)
  })

  afterAll(async () => {
    for (const [k, v] of savedEnv) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await rm(dataDir, { recursive: true, force: true })
  })

  it('md 直接入树：不进 _attachments、无解析稿包装', async () => {
    const res = await agent
      .post('/api/knowledge/upload')
      .field('path', '03.知识沉淀')
      .attach('files', fixture('note.md'), '我的笔记.md')
      .expect(200)
    const r = res.body.results[0]
    expect(r.ok).toBe(true)
    expect(r.draftPath).toBe('03.知识沉淀/我的笔记.md')
    expect(r.attachmentPath).toBeUndefined()
    const disk = await readFile(path.join(kbRoot, '03.知识沉淀', '我的笔记.md'), 'utf8')
    expect(disk).toBe('# 直接上传的正文\n')
    // 未产生附件区（md 直传不进 _attachments）
    const att = await readdir(path.join(kbRoot, '_attachments')).catch(() => null)
    expect(att ?? []).toHaveLength(0)
  })

  it('csv → 原件入附件区 + 解析稿 md 表格（含来源头）；重复上传自动加后缀', async () => {
    const csv = Buffer.from('项目,金额\n房租,3000\n伙食,1500\n', 'utf8')
    const res = await agent
      .post('/api/knowledge/upload')
      .field('path', '04.生活事务')
      .attach('files', csv, '月度开销.csv')
      .expect(200)
    const r = res.body.results[0]
    expect(r.ok).toBe(true)
    expect(String(r.attachmentPath)).toMatch(/^_attachments\/\d{8}\/[0-9a-f]+-月度开销\.csv$/)
    expect(String(r.draftPath)).toMatch(/^04\.生活事务\/月度开销-\d{8}\.md$/)

    const draft = await readFile(path.join(kbRoot, r.draftPath), 'utf8')
    expect(draft).toContain(`> 来源原件：${r.attachmentPath}`)
    expect(draft).toContain('解析方式：')
    expect(draft).toContain('| 项目 | 金额 |')
    expect(draft).toContain('| 房租 | 3000 |')

    // 重复上传同名：解析稿自动加序号，原件两份都在
    const res2 = await agent
      .post('/api/knowledge/upload')
      .field('path', '04.生活事务')
      .attach('files', csv, '月度开销.csv')
      .expect(200)
    const r2 = res2.body.results[0]
    expect(r2.ok).toBe(true)
    expect(r2.draftPath).not.toBe(r.draftPath)
    expect(String(r2.draftPath)).toMatch(/^04\.生活事务\/月度开销-\d{8}-\d+\.md$/)
    const bucketDir = path.join(kbRoot, '_attachments', String(r.attachmentPath).split('/')[1])
    expect((await readdir(bucketDir)).filter((f) => f.includes('月度开销'))).toHaveLength(2)
  })

  it('xlsx 多 sheet → sheet 名做二级标题 + 表格', async () => {
    const buf = await makeXlsx({
      '收入': [['月份', '金额'], ['1月', '20000']],
      '支出': [['项目', '金额'], ['房租', '3000']],
    })
    const res = await agent
      .post('/api/knowledge/upload')
      .field('path', '')
      .attach('files', buf, '年度账本.xlsx')
      .expect(200)
    const r = res.body.results[0]
    expect(r.ok).toBe(true)
    const draft = await readFile(path.join(kbRoot, r.draftPath), 'utf8')
    expect(draft).toContain('## 收入')
    expect(draft).toContain('## 支出')
    expect(draft).toContain('| 月份 | 金额 |')
    expect(draft).toContain('| 1月 | 20000 |')
  })

  it('pdf 文字层 → 解析稿含抽出文本', async () => {
    const res = await agent
      .post('/api/knowledge/upload')
      .field('path', '')
      .attach('files', fixture('sample.pdf'), '政策原文.pdf')
      .expect(200)
    const r = res.body.results[0]
    expect(r.ok).toBe(true)
    const draft = await readFile(path.join(kbRoot, r.draftPath), 'utf8')
    expect(draft).toContain('Workbench PDF Fixture')
    expect(draft).toContain('解析方式：pdf 文字层')
  })

  it('docx → mammoth 转 markdown（标题/段落）', async () => {
    const res = await agent
      .post('/api/knowledge/upload')
      .field('path', '')
      .attach('files', fixture('sample.docx'), '补贴细则.docx')
      .expect(200)
    const r = res.body.results[0]
    expect(r.ok).toBe(true)
    const draft = await readFile(path.join(kbRoot, r.draftPath), 'utf8')
    expect(draft).toContain('补贴办法要点')
    expect(draft).toContain('每月补贴八百元')
  })

  it('不支持的扩展名标红但不拖垮同批；超限 413', async () => {
    const res = await agent
      .post('/api/knowledge/upload')
      .field('path', '')
      .attach('files', Buffer.from('MZfake'), '病毒.exe')
      .attach('files', Buffer.from('a,b\n1,2\n'), '好的.csv')
      .expect(200)
    expect(res.body.results[0].ok).toBe(false)
    expect(res.body.results[0].error).toContain('不支持的')
    expect(res.body.results[1].ok).toBe(true)

    savedEnv.push(['WORKBENCH_KB_UPLOAD_MAX_MB', process.env.WORKBENCH_KB_UPLOAD_MAX_MB])
    process.env.WORKBENCH_KB_UPLOAD_MAX_MB = '1'
    await agent
      .post('/api/knowledge/upload')
      .field('path', '')
      .attach('files', Buffer.alloc(2 * 1024 * 1024, 7), '大文件.csv')
      .expect(413)
  })

  it('单批超过 10 个 → 400', async () => {
    let req = agent.post('/api/knowledge/upload').field('path', '')
    for (let i = 0; i < 11; i++) req = req.attach('files', Buffer.from('a,b\n1,2\n'), `批${i}.csv`)
    await req.expect(400)
  })
})
