// 知识库工具沙箱单测（0827-03）：路径穿越 / 黑名单 / Read-before-Write —— 纯本地逻辑，不涉网不碰真实知识库
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createKbToolset, isPrivateHost, normalizeRel, KbSandboxError } from './kbTools'

type Exec = (args: Record<string, unknown>) => Promise<unknown>
function execOf(tools: ReturnType<typeof createKbToolset>, name: string): Exec {
  return (tools as unknown as Record<string, { execute: Exec }>)[name].execute
}

let root: string
let tools: ReturnType<typeof createKbToolset>
let exec: (name: string, args: Record<string, unknown>) => Promise<unknown>

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'kb-sandbox-'))
  await mkdir(path.join(root, 'sub'), { recursive: true })
  await mkdir(path.join(root, '04.生活事务', '03.家庭账单'), { recursive: true })
  await mkdir(path.join(root, '_attachments', '20260829'), { recursive: true })
  await writeFile(path.join(root, 'a.md'), '# A\n\n第一段 old 内容，old 重复出现\n', 'utf8')
  await writeFile(path.join(root, 'sub', 'b.md'), 'hello b', 'utf8')
  await writeFile(path.join(root, '04.生活事务', '03.家庭账单', 'secret.md'), '机密', 'utf8')
  await writeFile(path.join(root, '_attachments', '20260829', '原件.pdf'), '%PDF-fake', 'utf8')
  await writeFile(path.join(root, '_system-note.md'), '系统残留', 'utf8')
  tools = createKbToolset({ root })
  exec = (name, args) => execOf(tools, name)(args)
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('路径沙箱', () => {
  it('normalizeRel 拒绝绝对路径与 .. 穿越，正常相对路径规范化', () => {
    expect(normalizeRel('a/b.md')).toBe('a/b.md')
    // 代码语义：路径里出现 .. 一律拒绝（即便归一化后仍在根内），不给边界情况留口子
    expect(() => normalizeRel('./sub/../a.md')).toThrow(KbSandboxError)
    expect(() => normalizeRel('D:/x')).toThrow(KbSandboxError)
    expect(() => normalizeRel('/etc/passwd')).toThrow(KbSandboxError)
    expect(() => normalizeRel('../outside.md')).toThrow(KbSandboxError)
    expect(() => normalizeRel('a/../../b.md')).toThrow(KbSandboxError)
  })

  it('kb_read 拒绝绝对路径 / 穿越 / 黑名单目录', async () => {
    await expect(exec('kb_read', { path: 'D:/windows/system.md' })).rejects.toThrow(KbSandboxError)
    await expect(exec('kb_read', { path: '../outside.md' })).rejects.toThrow(KbSandboxError)
    await expect(exec('kb_read', { path: '04.生活事务/03.家庭账单/secret.md' })).rejects.toThrow(/黑名单/)
  })

  it('kb_write 落点在根外（子目录组合穿越变体）也被 relative 复核拦下', async () => {
    // normalizeRel 挡住了显式 ..；这里是防御纵深第二层：resolve 后 relative 复核
    await expect(exec('kb_write', { path: '....//x.md', content: 'x' })).rejects.toThrow()
  })

  // Windows 无管理员/开发者模式建不了 symlink：该防护保留在实现里，用例仅在 POSIX 跑
  it.skipIf(process.platform === 'win32')('软链指向根外时拒绝读写', async () => {
    const outside = path.join(root, '..', `kb-outside-${Date.now()}.md`)
    await writeFile(outside, '外部文件', 'utf8')
    try {
      await symlink(outside, path.join(root, 'evil.md'))
      await expect(exec('kb_read', { path: 'evil.md' })).rejects.toThrow(/软链逃逸/)
      await expect(exec('kb_write', { path: 'evil.md', content: 'x' })).rejects.toThrow(/软链逃逸/)
    } finally {
      await rm(outside, { force: true })
      await rm(path.join(root, 'evil.md'), { force: true })
    }
  })
})

describe('Read-before-Write 强制', () => {
  it('新建文件免读直接写成功，且自动创建父目录', async () => {
    const r = (await exec('kb_write', { path: '03.知识沉淀/新分类/主题-20260827.md', content: '# 主题\n正文' })) as string
    expect(r).toContain('新建')
    const disk = await readFile(path.join(root, '03.知识沉淀', '新分类', '主题-20260827.md'), 'utf8')
    expect(disk).toContain('# 主题')
  })

  it('覆盖已有文件：未读拒绝，读过放行', async () => {
    await expect(exec('kb_write', { path: 'sub/b.md', content: '覆盖' })).rejects.toThrow(/必须先 kb_read/)
    await exec('kb_read', { path: 'sub/b.md' })
    const r = (await exec('kb_write', { path: 'sub/b.md', content: '已读后覆盖' })) as string
    expect(r).toContain('覆盖更新')
    expect(await readFile(path.join(root, 'sub', 'b.md'), 'utf8')).toBe('已读后覆盖')
  })

  it('kb_edit 未读拒绝；读后多处命中未开 replace_all 拒绝；replace_all 成功', async () => {
    await expect(exec('kb_edit', { path: 'a.md', old_string: 'old', new_string: 'new' })).rejects.toThrow(/必须先 kb_read/)
    await exec('kb_read', { path: 'a.md' })
    await expect(exec('kb_edit', { path: 'a.md', old_string: 'old', new_string: 'new' })).rejects.toThrow(/replace_all/)
    const r = (await exec('kb_edit', { path: 'a.md', old_string: 'old', new_string: 'new', replace_all: true })) as string
    expect(r).toContain('替换 2 处')
    expect(await readFile(path.join(root, 'a.md'), 'utf8')).toContain('new 重复')
  })
})

describe('查找类工具', () => {
  it('kb_glob 命中 md 文件并排除黑名单目录', async () => {
    const r = (await exec('kb_glob', { pattern: '**/*.md' })) as string
    expect(r).toContain('a.md')
    expect(r).toContain('主题-20260827.md')
    expect(r).not.toContain('secret.md')
    expect(r).not.toContain('家庭账单')
  })

  it('kb_grep 内容搜索命中且不泄露黑名单内容', async () => {
    // 前序用例会覆写 b.md/a.md，这里落独立标记文件保证断言自洽（新建免读）
    await exec('kb_write', { path: 'grep-target.md', content: '雾里看花 uniq-marker\n' })
    const r = (await exec('kb_grep', { pattern: 'uniq-marker' })) as string
    expect(r).toContain('grep-target.md')
    const secret = (await exec('kb_grep', { pattern: '机密' })) as string
    expect(secret).toBe('命中 0 处')
  })

  it('kb_tree 目录树不含黑名单分支', async () => {
    const r = (await exec('kb_tree', {})) as string
    expect(r).toContain('sub')
    expect(r).not.toContain('家庭账单')
  })

  it('kb_tree/kb_grep 直接指定黑名单子目录被拒', async () => {
    await expect(exec('kb_tree', { path: '04.生活事务/03.家庭账单' })).rejects.toThrow(/黑名单/)
  })
})

describe('顶级 `_` 系统目录全向拉黑（0828-01 §1.4）', () => {
  it('kb_read/kb_write/kb_edit 拒绝 `_` 开头顶级路径', async () => {
    await expect(exec('kb_read', { path: '_attachments/20260829/原件.pdf' })).rejects.toThrow(/系统目录/)
    await expect(exec('kb_write', { path: '_trash/x.md', content: 'x' })).rejects.toThrow(/系统目录/)
    await expect(exec('kb_edit', { path: '_system-note.md', old_string: 'a', new_string: 'b' })).rejects.toThrow(/系统目录/)
  })

  it('子目录下同名 `_` 前缀不受影响（仅顶级拉黑）', async () => {
    await mkdir(path.join(root, 'sub', '_drafts'), { recursive: true })
    await writeFile(path.join(root, 'sub', '_drafts', 'n.md'), '普通笔记', 'utf8')
    const r = (await exec('kb_read', { path: 'sub/_drafts/n.md' })) as string
    expect(r).toContain('普通笔记')
  })

  it('查找与树不泄露 `_` 目录内容，直接指定也被拒', async () => {
    const glob = (await exec('kb_glob', { pattern: '**/*' })) as string
    expect(glob).not.toContain('原件.pdf')
    expect(glob).not.toContain('_attachments')
    const grep = (await exec('kb_grep', { pattern: '系统残留' })) as string
    expect(grep).toBe('命中 0 处')
    await expect(exec('kb_tree', { path: '_attachments' })).rejects.toThrow(/系统目录/)
    const tree = (await exec('kb_tree', {})) as string
    expect(tree).not.toContain('_attachments')
    expect(tree).not.toContain('_system-note.md')
  })
})

describe('根目录 git 仓库元数据隐藏（0830-01 §1）', () => {
  beforeAll(async () => {
    await mkdir(path.join(root, '.git', 'objects'), { recursive: true })
    await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8')
    await writeFile(path.join(root, '.gitignore'), 'data/\n', 'utf8')
    await writeFile(path.join(root, 'CLAUDE.md'), '# 归位规则\n', 'utf8')
    await writeFile(path.join(root, 'README.md'), '# 目录地图\n', 'utf8')
    await mkdir(path.join(root, '调研笔记'), { recursive: true })
    await writeFile(path.join(root, '调研笔记', 'README.md'), '# 子目录笔记\n', 'utf8')
  })

  it('kb_tree 根目录不显形四个元数据名，子目录同名文件不受影响', async () => {
    const tree = (await exec('kb_tree', {})) as string
    // .git 与 .gitignore 共用前缀，一并断言
    expect(tree).not.toMatch(/\.git/)
    expect(tree).not.toContain('CLAUDE.md')
    // 只拦根级：子目录 README.md（2 空格缩进 = 第 2 层）必须照常出现
    expect(tree).not.toMatch(/(?:^|\n)📄 README\.md/)
    expect(tree).toMatch(/(?:^|\n) {2}📄 README\.md/)
    expect(tree).toContain('调研笔记')
  })

  it('kb_glob 不命中根元数据（与 kb_tree 同一 walk），子目录命中正常', async () => {
    const r = (await exec('kb_glob', { pattern: '**/README.md' })) as string
    expect(r).toContain('调研笔记/README.md')
    expect(r).not.toMatch(/(?:^|\n)- README\.md/)
    const rootMd = (await exec('kb_glob', { pattern: 'CLAUDE.md' })) as string
    expect(rootMd).toBe('命中 0 个文件')
  })
})

describe('SSRF 主机判定', () => {
  it('isPrivateHost 拦内网、放公网', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.1', '172.16.0.1', '172.31.255.255', '169.254.1.1', '[::1]', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'a.local', 'b.internal']) {
      expect(isPrivateHost(h), h).toBe(true)
    }
    for (const h of ['example.com', '8.8.8.8', '172.32.0.1', 'docs.bigmodel.cn']) {
      expect(isPrivateHost(h), h).toBe(false)
    }
  })
})
