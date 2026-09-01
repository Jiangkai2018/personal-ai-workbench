// 知识库文件工具集（0827-03）：kb_read/kb_write/kb_edit + kb_glob/kb_grep/kb_tree + web_fetch
// 沙箱：根锁 <dataDir>/knowledge/，拒绝绝对路径与 .. 穿越，软链逃逸用 realpath 逐级复核；
// 敏感目录黑名单（默认含 04.生活事务/03.家庭账单）对读写与检索全向拦截。
// 写安全（需求文档引 Claude Code 哲学）：Edit 必先 Read，覆盖已存在文件的 Write 必先 Read，
// 新建免读；已读集合按请求闭包跟踪（工具集每次 /chat 重建）。
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { tool } from 'ai'
import type { ToolSet } from 'ai'

/** 默认敏感目录黑名单（相对 knowledge 根，正斜杠）：家庭账单为 gitignore 的财务敏感数据 */
export const DEFAULT_KB_DENY = ['04.生活事务/03.家庭账单']

/**
 * KB 根目录需要隐藏的仓库元数据名（0830-01）：用户 KB 是独立 git 仓库，
 * 元数据物理保留但树里不显形；子目录同名文件不受影响。读路径（kb_read 直读）不拦——
 * buildKbSystemPrompt 需要读根 CLAUDE.md/README.md 注入系统提示。
 */
export const KB_HIDDEN_AT_ROOT = new Set(['.git', '.gitignore', 'CLAUDE.md', 'README.md'])

/** 允许读取的文本扩展名（图片/PDF/notebook 不在本轮 Read 能力内）；知识库页面同款判定复用 */
export const TEXT_EXTS = new Set(['.md', '.markdown', '.txt', '.json', '.csv', '.yml', '.yaml', '.html'])

const READ_FILE_MAX_BYTES = 256 * 1024
const WRITE_CONTENT_MAX_BYTES = 512 * 1024
const LIST_RESULT_CAP = 100
const GREP_RESULT_CAP = 80
const TREE_ENTRY_CAP = 400
const FETCH_CHUNK_CHARS = 20_000

export class KbSandboxError extends Error {}

// ── 沙箱路径解析 ────────────────────────────────────────

/** 相对路径规范化：反斜杠转正斜杠、拒绝绝对路径与 .. 穿越；返回 posix 风格相对路径 */
export function normalizeRel(input: string): string {
  const p = input.replaceAll('\\', '/').trim()
  if (!p || p === '.' || p === './') throw new KbSandboxError('路径不能为空')
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
    throw new KbSandboxError(`拒绝绝对路径「${input}」：只能使用相对知识库根的路径`)
  }
  if (p.split('/').includes('..')) throw new KbSandboxError(`拒绝「..」路径穿越：${input}`)
  return path.posix.normalize(p).replace(/^\.\//, '')
}

/** 黑名单前缀匹配：路径本身或位于黑名单目录之下都算命中 */
export function isDenied(rel: string, deny: string[]): boolean {
  const norm = rel.replaceAll('\\', '/')
  return deny.some((d) => {
    const dn = d.replaceAll('\\', '/').replace(/\/+$/, '')
    return norm === dn || norm.startsWith(dn + '/')
  })
}

/**
 * 顶级 `_` 前缀 = 系统目录（_attachments/_trash 等，0828-01 §1.4）：对 Agent 全向拉黑。
 * 只拦顶级——子目录里的 `_` 前缀是普通命名，不受影响。
 */
export function isSystemPath(rel: string): boolean {
  const first = rel.replaceAll('\\', '/').split('/')[0]
  return first.startsWith('_')
}

/**
 * 解析到根内绝对路径并做三重防护：
 * 1) normalizeRel 拒绝绝对路径/穿越；2) relative 复核；3) realpath 逐级复核软链逃逸。
 */
export async function resolveInRoot(root: string, input: string, deny: string[]): Promise<string> {
  const rel = normalizeRel(input)
  if (isDenied(rel, deny)) throw new KbSandboxError(`「${rel}」位于敏感目录黑名单，拒绝访问`)
  if (isSystemPath(rel)) throw new KbSandboxError(`「${rel}」位于「_」开头系统目录，Agent 不可访问`)
  const abs = path.resolve(root, rel)
  const back = path.relative(root, abs)
  if (back.startsWith('..') || path.isAbsolute(back)) throw new KbSandboxError(`路径越出知识库根：${input}`)

  const realRoot = await realpath(root).catch(() => root)
  let probe = abs
  for (;;) {
    const real = await realpath(probe).catch(() => null)
    if (real) {
      const r = path.relative(realRoot, real)
      if (r.startsWith('..') || path.isAbsolute(r)) {
        throw new KbSandboxError(`拒绝软链逃逸：${input} 指向知识库之外`)
      }
      break
    }
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  return abs
}

// ── web_fetch SSRF 防护 ────────────────────────────────

/** 主机名层面的私网判定（DNS 解析后的 IP 复核在 fetch 内另做） */
export function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^0\./.test(h)) return true
  const m172 = h.match(/^172\.(\d+)\./)
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
  return false
}

function isPrivateIp(ip: string): boolean {
  const lower = ip.toLowerCase()
  if (lower.includes(':')) {
    return lower === '::1' || lower === '::' || lower.startsWith('fe80:') || /^f[cd]/.test(lower)
  }
  const seg = ip.split('.').map(Number)
  if (seg.length !== 4) return true // 解析不出 v4 一律按私网处理
  const [a, b] = seg
  return (
    a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
  )
}

// ── 目录遍历（glob/grep/tree 共用） ─────────────────────

interface WalkEntry {
  rel: string
  abs: string
  mtimeMs: number
  size: number
  isDir: boolean
}

/** 递归遍历 root 下的文件（可选从子路径起）；黑名单目录整枝剪掉，不进结果也不下钻 */
async function walk(root: string, subRel: string, deny: string[]): Promise<WalkEntry[]> {
  const out: WalkEntry[] = []
  const startAbs = path.resolve(root, subRel)
  async function visit(dirAbs: string, dirRel: string) {
    let items: import('node:fs').Dirent[]
    try {
      items = await readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      const childRel = dirRel ? `${dirRel}/${it.name}` : it.name
      if (isDenied(childRel, deny) || isSystemPath(childRel)) continue
      if (!dirRel && KB_HIDDEN_AT_ROOT.has(it.name)) continue
      const childAbs = path.join(dirAbs, it.name)
      if (it.isDirectory()) {
        out.push({ rel: childRel + '/', abs: childAbs, mtimeMs: 0, size: 0, isDir: true })
        if (out.length > TREE_ENTRY_CAP * 2) return
        await visit(childAbs, childRel)
      } else if (it.isFile()) {
        const st = await stat(childAbs).catch(() => null)
        out.push({ rel: childRel, abs: childAbs, mtimeMs: st?.mtimeMs ?? 0, size: st?.size ?? 0, isDir: false })
      }
    }
  }
  await visit(startAbs, subRel.replace(/\/+$/, ''))
  return out
}

// 极简 glob → RegExp：双星加斜杠可跨零到多层目录、双星余文任意、单星限一段、问号单字符，其余字面量
function globToRegExp(pattern: string): RegExp {
  const p = pattern.replaceAll('\\', '/')
  let re = ''
  for (let i = 0; i < p.length; i++) {
    const ch = p[i]
    if (ch === '*') {
      if (p[i + 1] === '*') {
        if (p[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i++
        }
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${re}$`, 'u')
}


/** 剥离 HTML 标签为可读文本（script/style 整块剔除 + 常见实体解码） */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── 工具集工厂 ─────────────────────────────────────────

export interface KbToolsetDeps {
  /** 知识库根目录（绝对路径） */
  root: string
  /** 敏感目录黑名单（相对根，正斜杠） */
  deny?: string[]
}

/**
 * 构建知识库文件工具集。每次 /chat 调用一次：闭包里的 readPaths 就是本次请求的
 * 「已读」台账 —— 覆盖写与 Edit 都要凭它放行（Read-before-Write 强制约束）。
 */
export function createKbToolset(deps: KbToolsetDeps): ToolSet {
  const root = deps.root
  const deny = deps.deny ?? DEFAULT_KB_DENY
  const readPaths = new Set<string>()

  async function readTextFile(rel: string): Promise<{ abs: string; content: string; lines: string[] }> {
    const abs = await resolveInRoot(root, rel, deny)
    const st = await stat(abs).catch(() => null)
    if (!st || !st.isFile()) throw new KbSandboxError(`文件不存在或不是普通文件：${rel}`)
    if (!TEXT_EXTS.has(path.extname(abs).toLowerCase())) {
      throw new KbSandboxError(`仅支持读取文本类文件（md/txt/json 等），不支持的类型：${rel}`)
    }
    if (st.size > READ_FILE_MAX_BYTES) {
      throw new KbSandboxError(`文件过大（${Math.round(st.size / 1024)}KB > 256KB），请用 offset/limit 分段读`)
    }
    const content = await readFile(abs, 'utf8')
    return { abs, content, lines: content.split('\n') }
  }

  return {
    kb_read: tool({
      description:
        '读取知识库内的文本文件（md/txt/json 等），返回带行号的全文。path 为相对知识库根的路径；' +
        '大文件用 offset（起始行，1 起）+ limit（行数）分段读。编辑或覆盖文件前必须先读过它。',
      inputSchema: z.object({
        path: z.string().min(1).describe('相对知识库根的路径，如 03.知识沉淀/01.Agent与AI/xxx.md'),
        offset: z.number().int().min(1).optional().describe('起始行号（1 起），默认从头读'),
        limit: z.number().int().min(1).max(2000).optional().describe('最多读多少行，默认 2000'),
      }),
      execute: async ({ path: rel, offset, limit }) => {
        const { abs, lines } = await readTextFile(rel)
        readPaths.add(abs)
        const start = (offset ?? 1) - 1
        const slice = lines.slice(start, start + (limit ?? 2000))
        const numbered = slice.map((line, i) => `${String(start + i + 1).padStart(6)}\t${line}`).join('\n')
        return `共 ${lines.length} 行${start + slice.length < lines.length ? '（未完，可续读）' : ''}：\n${numbered}`
      },
    }),

    kb_write: tool({
      description:
        '把整篇内容写入知识库文件（落盘）。新建文件直接写；覆盖已有文件必须先用 kb_read 读过。' +
        '父目录不存在会自动创建；命名遵循知识库约定「主题-YYYYMMDD.md」。写入成功即落盘完成，不需用户再手工保存。',
      inputSchema: z.object({
        path: z.string().min(1).describe('目标路径（相对知识库根），如 03.知识沉淀/05.政策调研/北京外来务工政策-20260827.md'),
        content: z.string().min(1).describe('完整 Markdown 正文（以 # 标题开头，可附「> 来源：」引用行）'),
      }),
      execute: async ({ path: rel, content }) => {
        const abs = await resolveInRoot(root, rel, deny)
        const exists = await stat(abs).catch(() => null)
        if (exists?.isFile() && !readPaths.has(abs)) {
          throw new KbSandboxError(`覆盖已有文件前必须先 kb_read：「${rel}」。若是新文件请确认路径没有撞上现有文档。`)
        }
        const body = Buffer.from(content, 'utf8')
        if (body.length > WRITE_CONTENT_MAX_BYTES) throw new KbSandboxError('内容超过 512KB 上限，请精简或分篇写入')
        await mkdir(path.dirname(abs), { recursive: true })
        await writeFile(abs, content, 'utf8')
        readPaths.add(abs) // 写过即视为已知内容，允许紧接着 Edit
        return `已${exists ? '覆盖更新' : '新建'} ${rel}（${body.length} 字节，${content.split('\n').length} 行）`
      },
    }),

    kb_edit: tool({
      description:
        '对知识库已有文件做精确字符串替换（小改不必整篇重写）。必须先用 kb_read 读过该文件；' +
        'old_string 必须在文中唯一，多处命中时置 replace_all=true 全部替换。',
      inputSchema: z.object({
        path: z.string().min(1).describe('目标文件（相对知识库根），必须是读过的已有文件'),
        old_string: z.string().min(1).describe('要被替换的原文片段（须唯一）'),
        new_string: z.string().describe('替换后的内容'),
        replace_all: z.boolean().optional().describe('old_string 多处命中时是否全部替换，默认 false'),
      }),
      execute: async ({ path: rel, old_string, new_string, replace_all }) => {
        const { abs, content } = await readTextFile(rel)
        if (!readPaths.has(abs)) throw new KbSandboxError(`编辑前必须先 kb_read：「${rel}」`)
        const count = content.split(old_string).length - 1
        if (count === 0) throw new KbSandboxError(`old_string 在「${rel}」中未找到，请核对原文（注意空格与标点）`)
        if (count > 1 && !replace_all) {
          throw new KbSandboxError(`old_string 命中 ${count} 处且未开 replace_all，请加长片段保证唯一，或置 replace_all=true`)
        }
        const next = replace_all ? content.replaceAll(old_string, new_string) : content.replace(old_string, new_string)
        await writeFile(abs, next, 'utf8')
        return `已编辑 ${rel}（替换 ${replace_all ? count : 1} 处，现 ${Buffer.byteLength(next)} 字节）`
      },
    }),

    kb_glob: tool({
      description:
        '按文件名模式在知识库里找文件（如 **/*.md、01.决策档案/**/郑州*.md），结果按修改时间新→旧排序。',
      inputSchema: z.object({
        pattern: z.string().min(1).describe('glob 模式，** 跨目录、* 单段、? 单字符'),
      }),
      execute: async ({ pattern }) => {
        const re = globToRegExp(pattern)
        const entries = (await walk(root, '', deny)).filter((e) => !e.isDir && re.test(e.rel))
        entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
        const shown = entries.slice(0, LIST_RESULT_CAP)
        if (!shown.length) return `命中 0 个文件`
        return `命中 ${entries.length} 个文件：\n${shown.map((e) => `- ${e.rel}`).join('\n')}`
      },
    }),

    kb_grep: tool({
      description:
        '按内容正则搜索知识库全文（多用于查主题、找旧结论），可指定 glob 过滤文件名、' +
        'context 上下文行数、output_mode 选 files（只列文件）或 content（带行引用）。',
      inputSchema: z.object({
        pattern: z.string().min(1).describe('正则表达式'),
        glob: z.string().optional().describe('文件名过滤，如 **/*.md'),
        context: z.number().int().min(0).max(5).optional().describe('命中行前后各带几行上下文，默认 0'),
        output_mode: z.enum(['files', 'content']).optional().describe('输出模式，默认 content'),
      }),
      execute: async ({ pattern, glob, context = 0, output_mode = 'content' }) => {
        let re: RegExp
        try {
          re = new RegExp(pattern, 'u')
        } catch {
          throw new KbSandboxError(`无效正则：${pattern}`)
        }
        const fileRe = glob ? globToRegExp(glob) : null
        const files = (await walk(root, '', deny)).filter(
          (e) => !e.isDir && e.size <= READ_FILE_MAX_BYTES && TEXT_EXTS.has(path.extname(e.abs).toLowerCase()) && (!fileRe || fileRe.test(e.rel)),
        )
        const hits: string[] = []
        const hitFiles = new Set<string>()
        let hitCount = 0
        for (const f of files) {
          if (hitFiles.size >= LIST_RESULT_CAP) break
          const text = await readFile(f.abs, 'utf8').catch(() => '')
          if (!text || text.slice(0, 1024).includes('\0')) continue // 二进制嗅探
          const lines = text.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (!re.test(lines[i])) continue
            hitFiles.add(f.rel)
            hitCount++
            if (output_mode === 'files' || hits.length >= GREP_RESULT_CAP) continue
            const from = Math.max(0, i - context)
            const to = Math.min(lines.length, i + context + 1)
            for (let j = from; j < to; j++) {
              hits.push(`${f.rel}:${j + 1}${j === i ? ' ▶' : ' ─'} ${lines[j].slice(0, 240)}`)
            }
            if (context > 0) hits.push('…')
          }
        }
        if (output_mode === 'files') {
          const list = [...hitFiles]
          return list.length ? `命中 ${list.length} 个文件：\n${list.map((f) => `- ${f}`).join('\n')}` : '命中 0 个文件'
        }
        return hitCount
          ? `命中 ${hitFiles.size} 个文件 / ${hitCount} 处：\n${hits.join('\n')}`
          : '命中 0 处'
      },
    }),

    kb_tree: tool({
      description: '浏览知识库目录结构（默认全库 3 层深，可指定子目录与深度）。落盘前看一眼合适位置时用。',
      inputSchema: z.object({
        path: z.string().optional().describe('起始子目录（相对知识库根），默认全库'),
        depth: z.number().int().min(1).max(6).optional().describe('展开层数，默认 3'),
      }),
      execute: async ({ path: sub, depth = 3 }) => {
        const subRel = sub ? normalizeRel(sub) : ''
        if (subRel && isDenied(subRel, deny)) throw new KbSandboxError(`「${subRel}」位于敏感目录黑名单，拒绝访问`)
        if (subRel && isSystemPath(subRel)) throw new KbSandboxError(`「${subRel}」位于「_」开头系统目录，Agent 不可访问`)
        const entries = await walk(root, subRel, deny)
        const lines: string[] = [`${subRel || '知识库'}/`]
        let count = 0
        for (const e of entries) {
          if (count >= TREE_ENTRY_CAP) {
            lines.push(`…（超出 ${TREE_ENTRY_CAP} 项截断）`)
            break
          }
          const depthOf = e.rel.slice(subRel.length).split('/').length
          if (depthOf > depth) continue
          const indent = '  '.repeat(Math.max(0, depthOf - 1))
          lines.push(`${indent}${e.isDir ? '📁' : '📄'} ${e.rel.replace(/\/$/, '').split('/').pop()}`)
          count++
        }
        return `目录结构（${count} 项）：\n${lines.join('\n')}`
      },
    }),

    web_fetch: tool({
      description:
        '抓取网页原文（搜索摘要看不全时用）。自动剥离 HTML 标签留正文；超长页面按 start_index 分段读，' +
        '返回里会提示下一段的起点。仅支持公网 http/https。',
      inputSchema: z.object({
        url: z.string().url().describe('完整 http(s) 链接'),
        start_index: z.number().int().min(0).optional().describe('正文起始字符位，续读传上次返回的 next_start_index'),
      }),
      execute: async ({ url, start_index = 0 }) => {
        const u = new URL(url)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new KbSandboxError('仅支持 http/https')
        if (isPrivateHost(u.hostname)) throw new KbSandboxError('拒绝访问内网地址')

        // 手动跟跳 + 每跳复核 DNS（公网校验），最多 4 跳
        let target = u
        let text = ''
        for (let hop = 0; hop < 4; hop++) {
          const { lookup } = await import('node:dns/promises')
          const addrs = await lookup(target.hostname, { all: true }).catch(() => null)
          if (!addrs?.length || addrs.some((a) => isPrivateIp(a.address))) {
            throw new KbSandboxError('拒绝访问内网地址')
          }
          const res = await fetch(target, {
            redirect: 'manual',
            signal: AbortSignal.timeout(Number(process.env.WORKBENCH_FETCH_TIMEOUT_MS || 20_000)),
            headers: { 'user-agent': 'Mozilla/5.0 (compatible; workbench-agent/0.1)' },
          })
          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get('location')
            if (!loc) throw new KbSandboxError(`重定向缺少 Location（HTTP ${res.status}）`)
            target = new URL(loc, target)
            continue
          }
          if (!res.ok) throw new KbSandboxError(`抓取失败：HTTP ${res.status} ${target.host}`)
          const ctype = res.headers.get('content-type') ?? ''
          if (!/^(text\/|application\/(json|xml|javascript))/.test(ctype)) {
            throw new KbSandboxError(`不支持的内容类型：${ctype || '未知'}（仅支持文本类页面）`)
          }
          text = htmlToText(await res.text())
          break
        }

        const total = text.length
        if (!total) return '页面无可提取正文'
        const chunk = text.slice(start_index, start_index + FETCH_CHUNK_CHARS)
        const next = start_index + chunk.length
        const head = `共 ${total} 字，本次返回第 ${start_index}–${next} 字${next < total ? `，还有剩余；续读请传 start_index=${next}` : '（已到末尾）'}：\n`
        return head + chunk
      },
    }),
  }
}

// ── 归位规则注入（system 消息） ──────────────────────────

const RULE_FILE_MAX_CHARS = 4000

/**
 * 构建知识库 system 提示：基础工具约定 + README.md / CLAUDE.md 的归位规则原文。
 * 文件缺失（如 e2e 临时库）就跳过对应部分，绝不抛错阻塞对话。
 */
export async function buildKbSystemPrompt(root: string): Promise<string> {
  const parts: string[] = [
    '你是个人工作台里的 Agent，可直接操作本地知识库（Markdown 文档树）完成「调研 → 整合 → 落盘」闭环：',
    '- 工具：kb_read/kb_write/kb_edit（文件读写改）、kb_glob/kb_grep/kb_tree（文件与内容查找）、web_search（联网搜索）、web_fetch（抓网页原文）。',
    '- 落盘：用户让你「写入/落盘/存入知识库」时，必须实际调用 kb_write 完成，不要只给内容或让用户手工保存。',
    '- 新文件命名「主题-YYYYMMDD.md」，正文以 # 标题开头，网络调研须附「> 来源：」注明信源。',
    '- 覆盖或编辑已有文件前必须先 kb_read；落盘前可先 kb_tree/kb_glob 确认合适位置。',
    '',
  ]
  for (const [name, label] of [
    ['README.md', '知识库目录地图与使用铁律'],
    ['CLAUDE.md', '归位规则（新文件放哪）'],
  ] as const) {
    const raw = await readFile(path.join(root, name), 'utf8').catch(() => null)
    if (raw) parts.push(`===== ${label}（${name}）=====\n${raw.slice(0, RULE_FILE_MAX_CHARS)}\n===== ${name} 结束 =====\n`)
  }
  return parts.join('\n')
}
