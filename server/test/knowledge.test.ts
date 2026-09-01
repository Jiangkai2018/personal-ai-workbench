// 知识库页面路由单测（0828-01 §1.3）：树/读/写乐观锁/建/改名移动/回收站闭环
// 全走公开 HTTP 接口（supertest），临时 dataDir 隔离，不碰真实知识库。
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import request from 'supertest'
import { mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createApp } from '../src/api/app'
import { seedUsers, loginAgent } from './helpers'

describe('知识库 API', () => {
  let dataDir: string
  let kbRoot: string
  let app: ReturnType<typeof createApp>
  let agent: Awaited<ReturnType<typeof loginAgent>>

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'workbench-kb-'))
    kbRoot = path.join(dataDir, 'knowledge')
    await mkdir(path.join(kbRoot, '03.知识沉淀'), { recursive: true })
    await writeFile(path.join(kbRoot, '03.知识沉淀', '笔记.md'), '# 笔记\n\n正文\n', 'utf8')
    await writeFile(path.join(kbRoot, '简历.pdf'), '%PDF-fake-binary', 'utf8')
    await seedUsers(dataDir)
    app = createApp({ dataDir, jwtSecret: 'test-secret' })
    agent = await loginAgent(app)
  })

  afterAll(async () => {
    await rm(dataDir, { recursive: true, force: true })
  })

  it('未登录访问 → 401', async () => {
    await request(app).get('/api/knowledge/tree').expect(401)
  })

  it('tree 返回全部文件（二进制带标记），不混入顶级 `_` 系统目录', async () => {
    await writeFile(path.join(kbRoot, '_attachments', 'x.pdf'), 'x', { flag: 'w' }).catch(async () => {
      await mkdir(path.join(kbRoot, '_attachments'), { recursive: true })
      await writeFile(path.join(kbRoot, '_attachments', 'x.pdf'), 'x', 'utf8')
    })
    const res = await agent.get('/api/knowledge/tree').expect(200)
    const entries = res.body.entries as Array<{ path: string; type: string; binary?: boolean }>
    const note = entries.find((e) => e.path === '03.知识沉淀/笔记.md')
    expect(note?.type).toBe('file')
    const pdf = entries.find((e) => e.path === '简历.pdf')
    expect(pdf?.binary).toBe(true)
    expect(entries.some((e) => e.path.startsWith('_attachments'))).toBe(false)
  })

  it('file 读取返回内容与 mtime', async () => {
    const res = await agent.get('/api/knowledge/file').query({ path: '03.知识沉淀/笔记.md' }).expect(200)
    expect(res.body.content).toContain('# 笔记')
    expect(typeof res.body.mtime).toBe('number')
  })

  it('file 读取二进制 → binary 标记无内容', async () => {
    const res = await agent.get('/api/knowledge/file').query({ path: '简历.pdf' }).expect(200)
    expect(res.body.binary).toBe(true)
    expect(res.body.content).toBeUndefined()
  })

  it('PUT 新建文件成功并返回 mtime；重名未带 expectedMtime → 409 FILE_EXISTS', async () => {
    const put = await agent
      .put('/api/knowledge/file')
      .send({ path: '03.知识沉淀/新篇-20260829.md', content: '# 新篇\n' })
      .expect(200)
    expect(typeof put.body.mtime).toBe('number')

    await agent
      .put('/api/knowledge/file')
      .send({ path: '03.知识沉淀/新篇-20260829.md', content: '# 覆盖' })
      .expect(409)
  })

  it('乐观锁：expectedMtime 一致放行，过期 409 MODIFIED', async () => {
    const first = await agent.get('/api/knowledge/file').query({ path: '03.知识沉淀/新篇-20260829.md' }).expect(200)
    // 用过期 mtime 保存 → 409
    await agent
      .put('/api/knowledge/file')
      .send({ path: '03.知识沉淀/新篇-20260829.md', content: '# 抢写', expectedMtime: first.body.mtime - 99999 })
      .expect(409)
    const conflict = await agent
      .get('/api/knowledge/file')
      .query({ path: '03.知识沉淀/新篇-20260829.md' })
      .expect(200)
    expect(conflict.body.content).not.toContain('# 抢写')
    // 用正确 mtime 保存 → 成功
    await agent
      .put('/api/knowledge/file')
      .send({ path: '03.知识沉淀/新篇-20260829.md', content: '# 正常保存', expectedMtime: first.body.mtime })
      .expect(200)
    const after = await agent.get('/api/knowledge/file').query({ path: '03.知识沉淀/新篇-20260829.md' }).expect(200)
    expect(after.body.content).toContain('# 正常保存')
  })

  it('mkdir 建目录；重名拒绝', async () => {
    await agent.post('/api/knowledge/mkdir').send({ path: '01.决策档案/新分类' }).expect(200)
    await agent.post('/api/knowledge/mkdir').send({ path: '01.决策档案/新分类' }).expect(409)
  })

  it('rename：成功改名；目标已存在拒绝；目录移入自身拒绝；`_` 区拒绝', async () => {
    await agent.post('/api/knowledge/rename').send({ from: '03.知识沉淀/新篇-20260829.md', to: '03.知识沉淀/改名.md' }).expect(200)
    // 目标已存在
    await agent.post('/api/knowledge/rename').send({ from: '03.知识沉淀/改名.md', to: '03.知识沉淀/笔记.md' }).expect(409)
    // 目录移入自身
    await agent
      .post('/api/knowledge/rename')
      .send({ from: '03.知识沉淀', to: '03.知识沉淀/子目录' })
      .expect(400)
    // 系统区
    await agent.post('/api/knowledge/rename').send({ from: '简历.pdf', to: '_attachments/a.pdf' }).expect(400)
  })

  it('删除 → 回收站日期分桶；同日同路径再删加时间后缀', async () => {
    const d1 = await agent.post('/api/knowledge/delete').send({ path: '03.知识沉淀/改名.md' }).expect(200)
    expect(String(d1.body.trashedTo)).toMatch(/^_trash\/\d{8}\/03\.知识沉淀\/改名\.md$/)
    // 重建同名文件再删 → 不覆盖第一份
    await agent.put('/api/knowledge/file').send({ path: '03.知识沉淀/改名.md', content: '# 第二份' }).expect(200)
    const d2 = await agent.post('/api/knowledge/delete').send({ path: '03.知识沉淀/改名.md' }).expect(200)
    expect(String(d2.body.trashedTo)).toMatch(/^_trash\/\d{8}\/03\.知识沉淀\/改名-\d{6}\.md$/)
  })

  it('trash 列表展示原路径；恢复回原位；原位被占加后缀', async () => {
    const list = await agent.get('/api/knowledge/trash').expect(200)
    const items = list.body.items as Array<{ path: string; originalPath: string }>
    expect(items.length).toBeGreaterThanOrEqual(2)
    expect(items.some((i) => i.originalPath === '03.知识沉淀/改名.md')).toBe(true)

    // 恢复第一条（原位当前空闲？——原位已有第二份被删后是空的）
    const first = items.find((i) => i.trashedTo && !/\d{6}\.md$/.test(i.path)) ?? items[0]
    const r1 = await agent.post('/api/knowledge/restore').send({ path: first.path }).expect(200)
    expect(r1.body.restoredTo).toBe('03.知识沉淀/改名.md')

    // 原位被占场景：覆盖刚恢复回来的文件作为占位，再恢复另一份
    const cur = await agent.get('/api/knowledge/file').query({ path: '03.知识沉淀/改名.md' }).expect(200)
    await agent
      .put('/api/knowledge/file')
      .send({ path: '03.知识沉淀/改名.md', content: '# 占位', expectedMtime: cur.body.mtime })
      .expect(200)
    const list2 = await agent.get('/api/knowledge/trash').expect(200)
    const second = list2.body.items[0]
    const r2 = await agent.post('/api/knowledge/restore').send({ path: second.path }).expect(200)
    expect(r2.body.restoredTo).not.toBe('03.知识沉淀/改名.md')
    expect(String(r2.body.restoredTo)).toMatch(/^03\.知识沉淀\/改名-\d+\.md$/)
  })

  it('purge 彻底删除回收站内文件（二次确认在前端）', async () => {
    // 自建回收项：建→删→彻底删
    await agent.put('/api/knowledge/file').send({ path: '03.知识沉淀/待毁灭.md', content: '# x' }).expect(200)
    const d = await agent.post('/api/knowledge/delete').send({ path: '03.知识沉淀/待毁灭.md' }).expect(200)
    const trashedPath = String(d.body.trashedTo)
    await agent.delete('/api/knowledge/purge').query({ path: trashedPath }).expect(200)
    const list2 = await agent.get('/api/knowledge/trash').expect(200)
    expect(list2.body.items.some((i: { path: string }) => i.path === trashedPath)).toBe(false)
  })

  it('路径穿越与 `_` 区直接访问被拒', async () => {
    await agent.get('/api/knowledge/file').query({ path: '../secret.md' }).expect(400)
    await agent.get('/api/knowledge/file').query({ path: '/etc/passwd' }).expect(400)
    await agent.put('/api/knowledge/file').send({ path: '_trash/evil.md', content: 'x' }).expect(400)
  })

  // 占位避免未用变量告警（stat 在下方附件用例中使用）
  it('sanity: kbRoot 存在', async () => {
    expect((await stat(kbRoot)).isDirectory()).toBe(true)
  })

  it('tree 隐藏根目录 git 仓库元数据，子目录同名文件不受影响（0830-01 §1）', async () => {
    await mkdir(path.join(kbRoot, '.git'), { recursive: true })
    await writeFile(path.join(kbRoot, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    await writeFile(path.join(kbRoot, '.gitignore'), 'data/\n', 'utf8')
    await writeFile(path.join(kbRoot, 'CLAUDE.md'), '# 归位规则\n', 'utf8')
    await writeFile(path.join(kbRoot, 'README.md'), '# 目录地图\n', 'utf8')
    await mkdir(path.join(kbRoot, '调研笔记'), { recursive: true })
    await writeFile(path.join(kbRoot, '调研笔记', 'README.md'), '# 子目录笔记\n', 'utf8')

    const res = await agent.get('/api/knowledge/tree').expect(200)
    const entries = res.body.entries as Array<{ path: string }>
    const hidden = ['.git/', '.gitignore', 'CLAUDE.md', 'README.md']
    for (const h of hidden) expect(entries.some((e) => e.path === h), h).toBe(false)
    expect(entries.some((e) => e.path === '调研笔记/README.md')).toBe(true)
  })
})
