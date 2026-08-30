// 附件区 API + 视觉转写编排单测（0828-01 §2.1/§1.3 / 决策 #17 #19）
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'
import { ParseError, VisionRequiredError, parseToMarkdown } from '../src/knowledge/parse'
import { transcribeScannedPdf, visionMaxPages } from '../src/knowledge/vision'

describe('附件区 API', () => {
  let dataDir: string
  let app: ReturnType<typeof createApp>
  let agent: Awaited<ReturnType<typeof loginAgent>>
  let attachPath = ''

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-attach-'))
    await seedUsers(dataDir)
    app = createApp({ dataDir, jwtSecret: 'test-secret' })
    agent = await loginAgent(app)
    // 经上传管道造一个原件
    const res = await agent
      .post('/api/knowledge/upload')
      .field('path', '')
      .attach('files', Buffer.from('a,b\n1,2\n'), '附件清单.csv')
      .expect(200)
    attachPath = res.body.results[0].attachmentPath
  })

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('下载原件字节一致', async () => {
    const res = await agent.get('/api/knowledge/attachment').query({ path: attachPath }).expect(200).buffer(true)
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.body.toString()).toBe('a,b\n1,2\n')
  })

  it('附件列表可见', async () => {
    const res = await agent.get('/api/knowledge/attachments').expect(200)
    expect(res.body.items.some((i: { path: string }) => i.path === attachPath)).toBe(true)
  })

  it('删除原件：提示引用数、真删不走回收站、列表消失', async () => {
    const res = await agent.delete('/api/knowledge/attachment').query({ path: attachPath }).expect(200)
    expect(res.body.references).toBe(1) // 解析稿引用着它
    const list = await agent.get('/api/knowledge/attachments').expect(200)
    expect(list.body.items.some((i: { path: string }) => i.path === attachPath)).toBe(false)
    // 回收站为空（真删）
    const trash = await agent.get('/api/knowledge/trash').expect(200)
    expect(trash.body.items).toHaveLength(0)
  })

  it('越界访问拒绝：非 _attachments 路径 400、不存在 404', async () => {
    await agent.get('/api/knowledge/attachment').query({ path: '03.x/秘密.md' }).expect(400)
    await agent.get('/api/knowledge/attachment').query({ path: '_attachments/20990101/ghost.csv' }).expect(404)
    await agent.delete('/api/knowledge/attachment').query({ path: '03.x/秘密.md' }).expect(400)
  })
})

describe('视觉转写编排', () => {
  const png = readFileSync(path.join(import.meta.dirname, 'fixtures', 'sample.png'))

  it('未配置视觉模型：图片与扫描件明确拒收（不静默降级）', async () => {
    await expect(parseToMarkdown('photo.png', png, undefined)).rejects.toThrow(VisionRequiredError)
    const scanned = readFileSync(path.join(import.meta.dirname, 'fixtures', 'sample-scan.pdf'))
    await expect(parseToMarkdown('scan.pdf', scanned, undefined)).rejects.toThrow(VisionRequiredError)
  })

  it('图片 + 注入视觉函数 → 转写文本为解析稿正文', async () => {
    const r = await parseToMarkdown('photo.png', png, async () => '图片里的文字内容')
    expect(r?.method).toBe('视觉模型转写')
    expect(r?.body).toBe('图片里的文字内容')
  })

  it('不支持的类型抛 ParseError', async () => {
    await expect(parseToMarkdown('virus.exe', Buffer.from('MZ'), undefined)).rejects.toThrow(ParseError)
  })

  it('扫描 PDF 逐页渲染 + 注入视觉函数；超页上限截断注明', async () => {
    const calls: number[] = []
    const origLimit = process.env.WORKBENCH_KB_VISION_MAX_PAGES
    process.env.WORKBENCH_KB_VISION_MAX_PAGES = '1'
    expect(visionMaxPages()).toBe(1)
    const scanned = readFileSync(path.join(import.meta.dirname, 'fixtures', 'sample2.pdf'))
    const r = await transcribeScannedPdf(scanned, async (buf) => {
      calls.push(buf.length)
      expect([...buf.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]) // 页面确实渲染成了 PNG
      return '页面转写文本'
    })
    process.env.WORKBENCH_KB_VISION_MAX_PAGES = origLimit
    expect(calls).toHaveLength(1) // 2 页只转 1 页
    expect(r).toContain('## 第 1 页')
    expect(r).toContain('页面转写文本')
    expect(r).toContain('仅转写了前 1 页')
  }, 30_000)
})
