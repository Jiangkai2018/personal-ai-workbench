// 知识库页面路由（0828-01 §1.3）：树 / 读 / 写（乐观锁）/ 建 / 改名移动 / 回收站（删除→恢复→彻底删除）/ 上传解析
// 边界（决策 D-06）：路径校验复用 Agent 沙箱（normalizeRel + resolveInRoot），但不挂敏感目录黑名单
// ——黑名单是挡 AI 的，不挡家人；顶级 `_` 系统目录只走附件区/回收站专用端点。
import { Router } from 'express'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import multer from 'multer'
import { KB_HIDDEN_AT_ROOT, KbSandboxError, normalizeRel, resolveInRoot, TEXT_EXTS } from '../../agent/kbTools'
import { ParseError, VisionRequiredError, UPLOAD_EXTS, buildDraftMarkdown, parseToMarkdown } from '../../knowledge/parse'
import { makeVisionTranscribe } from '../../knowledge/vision'

const TREE_ENTRY_CAP = 600
const FILE_MAX_BYTES = 2 * 1024 * 1024
const TRASH = '_trash'
const ATTACH = '_attachments'
const UPLOAD_BATCH_LIMIT = 10

/** 单文件上传上限（MB），每次请求现读环境变量（测试可覆盖） */
function uploadMaxBytes(): number {
  return Number(process.env.WORKBENCH_KB_UPLOAD_MAX_MB || 20) * 1024 * 1024
}

/** 文件名安全化：只留 basename，去控制字符，限长 */
function safeName(name: string): string {
  const raw = path.posix.basename(name.replaceAll('\\', '/'))
  let out = ''
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    if (code >= 32 && code !== 127) out += ch
  }
  return out.slice(-120)
}

/** `_attachments` 内路径解析：必须是系统区内的既有文件，防越界 */
async function attachResolve(kbRoot: string, raw: string): Promise<{ rel: string; abs: string }> {
  const rel = normalizeRel(raw)
  if (!rel.startsWith(`${ATTACH}/`) || isSystemTop(rel.slice(ATTACH.length + 1))) {
    throw new KbSandboxError(`路径不在附件区内：${raw}`)
  }
  const abs = path.join(kbRoot, rel)
  const back = path.relative(kbRoot, abs)
  if (back.startsWith('..') || path.isAbsolute(back)) throw new KbSandboxError(`路径越出知识库根：${raw}`)
  return { rel, abs }
}

/** 剩余段里再出现 `_` 顶级目录名同样拒绝（防拼接绕过） */
function isSystemTop(rest: string): boolean {
  const first = rest.split('/')[0]
  return !first || first.startsWith('_')
}

/** 统计某原件被多少篇解析稿引用（扫全部 md 正文中的来源行，`_` 区除外） */
async function countDraftReferences(kbRoot: string, attachRel: string): Promise<number> {
  const needle = `> 来源原件：${attachRel}`
  let count = 0
  const stack = [kbRoot]
  while (stack.length) {
    const dir = stack.pop()!
    const items = (await readdir(dir, { withFileTypes: true }).catch(() => [])) as import('node:fs').Dirent[]
    for (const it of items) {
      if (it.name.startsWith('_') && dir === kbRoot) continue
      const abs = path.join(dir, it.name)
      if (it.isDirectory()) stack.push(abs)
      else if (/\.(md|markdown|txt)$/i.test(it.name)) {
        const text = await readFile(abs, 'utf8').catch(() => '')
        if (text.includes(needle)) count++
      }
    }
  }
  return count
}

function todayStamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
}

function nowTimeSuffix(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/** 「名字-后缀.ext」：把后缀插在扩展名前 */
function withStemSuffix(rel: string, suffix: string): string {
  const dir = path.posix.dirname(rel)
  const ext = path.posix.extname(rel)
  const stem = path.posix.basename(rel, ext)
  const name = `${stem}-${suffix}${ext}`
  return dir === '.' ? name : `${dir}/${name}`
}

/**
 * 剥离回收站冲突后缀（-HHmmss，决策 #16）：站内工件不属于原始路径，恢复/列表时还原真名。
 * 启发式：仅当尾缀 6 位数字恰为合法时分秒才剥离；极端撞名（文件本就叫 xx-123456.md）可接受。
 */
function stripTrashSuffix(rel: string): string {
  const dir = path.posix.dirname(rel)
  const base = path.posix.basename(rel)
  const m = base.match(/^(.+)-(\d{6})(\.[^.]+)$/)
  if (!m) return rel
  const [, stem, t, ext] = m
  const hh = Number(t.slice(0, 2))
  const mm = Number(t.slice(2, 4))
  const ss = Number(t.slice(4, 6))
  const looksLikeTime = hh < 24 && mm < 60 && ss < 60
  if (!looksLikeTime) return rel
  const restored = `${stem}${ext}`
  return dir === '.' ? restored : `${dir}/${restored}`
}

/** 目标被占时追加 `-1` `-2`… 直到可用（恢复原位被占、上传重名共用） */
async function uniqueRel(root: string, rel: string): Promise<string> {
  if (!(await stat(path.resolve(root, rel)).catch(() => null))) return rel
  for (let i = 1; ; i++) {
    const candidate = withStemSuffix(rel, String(i))
    if (!(await stat(path.resolve(root, candidate)).catch(() => null))) return candidate
  }
}

interface TreeEntry {
  path: string
  name: string
  type: 'dir' | 'file'
  size: number
  mtime: number
  binary: boolean
}

async function listTree(root: string, subRel: string, depth: number): Promise<TreeEntry[]> {
  const out: TreeEntry[] = []
  async function visit(dirAbs: string, dirRel: string, level: number) {
    let items: import('node:fs').Dirent[]
    try {
      items = await readdir(dirAbs, { withFileTypes: true })
    } catch {
      return
    }
    for (const it of items) {
      if (out.length >= TREE_ENTRY_CAP) return
      const childRel = dirRel ? `${dirRel}/${it.name}` : it.name
      // 顶级 `_` 系统目录不混进普通树（附件区/回收站走专用端点）
      if (!dirRel && it.name.startsWith('_')) continue
      // 根目录 git 仓库元数据不显形（0830-01；与 Agent 侧 walk() 同一规则，双端一致）
      if (!dirRel && KB_HIDDEN_AT_ROOT.has(it.name)) continue
      if (it.isDirectory()) {
        out.push({ path: childRel + '/', name: it.name, type: 'dir', size: 0, mtime: 0, binary: false })
        if (level < depth) await visit(path.join(dirAbs, it.name), childRel, level + 1)
      } else if (it.isFile()) {
        const st = await stat(path.join(dirAbs, it.name)).catch(() => null)
        out.push({
          path: childRel,
          name: it.name,
          type: 'file',
          size: st?.size ?? 0,
          mtime: st?.mtimeMs ?? 0,
          binary: !TEXT_EXTS.has(path.extname(it.name).toLowerCase()),
        })
      }
    }
  }
  await visit(path.resolve(root, subRel), subRel.replace(/\/+$/, ''), 1)
  return out
}

/** 清掉回收站里的空桶/空目录（删完/恢复完调用） */
async function pruneEmptyTrashDirs(trashRoot: string, dirAbs: string) {
  let dir = dirAbs
  while (dir.startsWith(trashRoot) && dir !== trashRoot) {
    const items = await readdir(dir).catch(() => null)
    if (!items || items.length > 0) break
    await rm(dir, { recursive: true })
    dir = path.dirname(dir)
  }
}

/** 统一错误出口：沙箱类错误 → 400，其余交全局 500 */
function fail(res: import('express').Response, err: unknown) {
  if (err instanceof KbSandboxError) {
    res.status(400).json({ error: 'INVALID_PATH', message: err.message })
    return
  }
  const e = err as NodeJS.ErrnoException
  if (e?.code === 'ENOENT') {
    res.status(404).json({ error: 'NOT_FOUND', message: '路径不存在' })
    return
  }
  throw err
}

/** 人侧路径解析：先确保根存在（全新 dataDir 首次访问），再 normalizeRel + resolveInRoot（黑名单为空、`_` 区由系统检查拦截） */
async function humanResolve(kbRoot: string, input: string): Promise<{ rel: string; abs: string }> {
  await mkdir(kbRoot, { recursive: true }).catch(() => {})
  const rel = normalizeRel(input)
  const abs = await resolveInRoot(kbRoot, rel, [])
  return { rel, abs }
}

export function knowledgeRouter(dataDir: string): Router {
  const kbRoot = path.join(dataDir, 'knowledge')
  const trashRoot = path.join(kbRoot, TRASH)
  const router = Router()

  // ── 目录树 ──────────────────────────────────────────
  router.get('/tree', async (req, res, next) => {
    try {
      const q = z
        .object({ path: z.string().optional(), depth: z.coerce.number().int().min(1).max(8).optional() })
        .parse(req.query)
      const subRel = q.path ? normalizeRel(q.path) : ''
      const entries = await listTree(kbRoot, subRel, q.depth ?? 4)
      res.json({ entries })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // ── 读文件（含 mtime 供乐观锁） ─────────────────────
  router.get('/file', async (req, res, next) => {
    try {
      const { rel, abs } = await humanResolve(kbRoot, z.object({ path: z.string() }).parse(req.query).path)
      const st = await stat(abs).catch(() => null)
      if (!st?.isFile()) return void res.status(404).json({ error: 'NOT_FOUND', message: '文件不存在' })
      const binary = !TEXT_EXTS.has(path.extname(abs).toLowerCase())
      if (binary) return void res.json({ path: rel, binary: true, size: st.size, mtime: st.mtimeMs })
      if (st.size > FILE_MAX_BYTES) {
        return void res.status(400).json({ error: 'TOO_LARGE', message: '文件超过 2MB，页面不支持直接编辑' })
      }
      res.json({ path: rel, binary: false, content: await readFile(abs, 'utf8'), mtime: st.mtimeMs })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // ── 新建/保存（乐观锁） ─────────────────────────────
  router.put('/file', async (req, res, next) => {
    try {
      const body = z
        .object({ path: z.string(), content: z.string().max(FILE_MAX_BYTES), expectedMtime: z.number().optional() })
        .parse(req.body)
      const { abs } = await humanResolve(kbRoot, body.path)
      const st = await stat(abs).catch(() => null)
      if (st?.isDirectory()) return void res.status(400).json({ error: 'IS_DIR', message: '目标路径是目录' })
      if (st) {
        if (body.expectedMtime === undefined) {
          return void res
            .status(409)
            .json({ error: 'FILE_EXISTS', message: '文件已存在，请改名或打开后编辑' })
        }
        if (body.expectedMtime !== st.mtimeMs) {
          return void res.status(409).json({
            error: 'MODIFIED',
            message: '文件已被修改（可能被 Agent 落盘），请刷新后重试',
          })
        }
      }
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, body.content, 'utf8')
      const saved = await stat(abs)
      res.json({ ok: true, mtime: saved.mtimeMs })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // ── 建目录 ──────────────────────────────────────────
  router.post('/mkdir', async (req, res, next) => {
    try {
      const { abs } = await humanResolve(kbRoot, z.object({ path: z.string() }).parse(req.body).path)
      if (await stat(abs).catch(() => null)) {
        return void res.status(409).json({ error: 'EXISTS', message: '目录或同名文件已存在' })
      }
      await mkdir(abs, { recursive: true })
      res.json({ ok: true })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // ── 重命名 / 移动 ───────────────────────────────────
  router.post('/rename', async (req, res, next) => {
    try {
      const body = z.object({ from: z.string(), to: z.string() }).parse(req.body)
      const from = await humanResolve(kbRoot, body.from)
      const to = await humanResolve(kbRoot, body.to)
      if (from.rel === to.rel) return void res.status(400).json({ error: 'SAME_PATH', message: '源与目标相同' })
      const fromSt = await stat(from.abs).catch(() => null)
      if (!fromSt) return void res.status(404).json({ error: 'NOT_FOUND', message: '源路径不存在' })
      if (fromSt.isDirectory() && (to.rel + '/').startsWith(from.rel + '/')) {
        return void res.status(400).json({ error: 'INTO_SELF', message: '不能把目录移动到它自身内部' })
      }
      if (await stat(to.abs).catch(() => null)) {
        return void res.status(409).json({ error: 'EXISTS', message: '目标路径已存在' })
      }
      await mkdir(path.dirname(to.abs), { recursive: true })
      await rename(from.abs, to.abs)
      res.json({ ok: true })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // ── 删除 → 回收站（日期分桶，同日同路径加时间后缀） ──
  router.post('/delete', async (req, res, next) => {
    try {
      const { rel, abs } = await humanResolve(kbRoot, z.object({ path: z.string() }).parse(req.body).path)
      const st = await stat(abs).catch(() => null)
      if (!st) return void res.status(404).json({ error: 'NOT_FOUND', message: '路径不存在' })
      const bucket = todayStamp()
      let destRel = `${TRASH}/${bucket}/${rel}`
      let destAbs = path.join(trashRoot, bucket, rel)
      if (await stat(destAbs).catch(() => null)) {
        // 同日同路径冲突：加 -HHmmss 防覆盖（决策 #16）；同秒再撞加序号兜底
        destRel = withStemSuffix(`${TRASH}/${bucket}/${rel}`, nowTimeSuffix())
        destAbs = path.join(kbRoot, destRel)
        while (await stat(destAbs).catch(() => null)) {
          destRel = withStemSuffix(destRel, nowTimeSuffix() + '-' + Math.floor(Math.random() * 10))
          destAbs = path.join(kbRoot, destRel)
        }
      }
      await mkdir(path.dirname(destAbs), { recursive: true })
      await rename(abs, destAbs)
      res.json({ ok: true, trashedTo: destRel })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // ── 回收站列表 ──────────────────────────────────────
  router.get('/trash', async (_req, res, next) => {
    try {
      const items: Array<{ path: string; originalPath: string; name: string; size: number; mtime: number }> = []
      const buckets = (await readdir(trashRoot, { withFileTypes: true }).catch(() => [])) as import('node:fs').Dirent[]
      for (const bucket of buckets) {
        if (!bucket.isDirectory()) continue
        const stack: Array<{ abs: string; rel: string }> = [
          { abs: path.join(trashRoot, bucket.name), rel: bucket.name },
        ]
        while (stack.length) {
          const cur = stack.pop()!
          const entries = (await readdir(cur.abs, { withFileTypes: true }).catch(() => [])) as import('node:fs').Dirent[]
          for (const e of entries) {
            const childAbs = path.join(cur.abs, e.name)
            const childRel = `${cur.rel}/${e.name}`
            if (e.isDirectory()) stack.push({ abs: childAbs, rel: childRel })
            else {
              const st = await stat(childAbs).catch(() => null)
              items.push({
                path: `${TRASH}/${childRel}`,
                originalPath: stripTrashSuffix(childRel.slice(bucket.name.length + 1)),
                name: e.name,
                size: st?.size ?? 0,
                mtime: st?.mtimeMs ?? 0,
              })
            }
          }
        }
      }
      items.sort((a, b) => b.mtime - a.mtime)
      res.json({ items })
    } catch (err) {
      next(err)
    }
  })

  // ── 恢复（原位被占加 -N 后缀） ──────────────────────
  router.post('/restore', async (req, res, next) => {
    try {
      const raw = z.object({ path: z.string() }).parse(req.body).path
      const rel = normalizeRel(raw)
      if (!rel.startsWith(`${TRASH}/`)) {
        return void res.status(400).json({ error: 'NOT_IN_TRASH', message: '只能恢复回收站内的文件' })
      }
      const rest = rel.slice(TRASH.length + 1)
      const bucket = rest.split('/')[0]
      const originalPath = rest.slice(bucket.length + 1)
      if (!bucket || !originalPath) {
        return void res.status(400).json({ error: 'NOT_IN_TRASH', message: '回收站路径不合法' })
      }
      const destRel0 = stripTrashSuffix(originalPath)
      const srcAbs = path.join(trashRoot, bucket, originalPath)
      if (!(await stat(srcAbs).catch(() => null))) {
        return void res.status(404).json({ error: 'NOT_FOUND', message: '回收站内不存在该路径' })
      }
      const destRel = await uniqueRel(kbRoot, normalizeRel(destRel0))
      const destAbs = path.join(kbRoot, destRel)
      await mkdir(path.dirname(destAbs), { recursive: true })
      await rename(srcAbs, destAbs)
      await pruneEmptyTrashDirs(trashRoot, path.dirname(srcAbs))
      res.json({ ok: true, restoredTo: destRel })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // ── 彻底删除（回收站内；二次确认在前端） ────────────
  router.delete('/purge', async (req, res, next) => {
    try {
      const raw = z.object({ path: z.string() }).parse(req.query).path
      const rel = normalizeRel(raw)
      if (!rel.startsWith(`${TRASH}/`)) {
        return void res.status(400).json({ error: 'NOT_IN_TRASH', message: '只能彻底删除回收站内的文件' })
      }
      const abs = path.join(kbRoot, rel)
      const st = await stat(abs).catch(() => null)
      if (!st) return void res.status(404).json({ error: 'NOT_FOUND', message: '路径不存在' })
      await rm(abs, { recursive: true })
      await pruneEmptyTrashDirs(trashRoot, path.dirname(abs))
      res.json({ ok: true })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // ── 上传（multipart）：md/txt 直接入树；其余原件入 _attachments + 解析稿入树 ──
  router.post('/upload', (req, res, next) => {
    multer({
      storage: multer.memoryStorage(),
      limits: { files: UPLOAD_BATCH_LIMIT, fileSize: uploadMaxBytes() },
      defParamCharset: 'utf8', // 中文文件名按 UTF-8 解析（缺省 latin-1 会乱码）
    }).array('files', UPLOAD_BATCH_LIMIT)(req, res, (err) => {
      if (!err) return next()
      const m = err as import('multer').MulterError
      if (m?.code === 'LIMIT_FILE_SIZE') {
        return void res.status(413).json({ error: 'TOO_LARGE', message: `单文件超过 ${process.env.WORKBENCH_KB_UPLOAD_MAX_MB || 20}MB 上限` })
      }
      if (m?.code === 'LIMIT_UNEXPECTED_FILE' || m?.code === 'LIMIT_FILE_COUNT') {
        return void res.status(400).json({ error: 'TOO_MANY', message: `单批最多 ${UPLOAD_BATCH_LIMIT} 个文件` })
      }
      next(err)
    })
  })

  router.post('/upload', async (req, res, next) => {
    try {
      const files = (req.files ?? []) as Array<Express.Multer.File>
      if (!files.length) return void res.status(400).json({ error: 'NO_FILES', message: '没有收到文件' })
      const rawTarget = String(req.body?.path ?? '').trim()
      const targetRel = rawTarget ? normalizeRel(rawTarget) : ''
      if (targetRel) await humanResolve(kbRoot, targetRel) // 目标目录合法性（`_` 区、穿越拒绝）；空 = 根目录
      const targetAbs = path.join(kbRoot, targetRel)
      await mkdir(targetAbs, { recursive: true }).catch(() => {})

      // 视觉转写器（未配置 → 扫描件/图片在解析步明确报错，原件仍入库）
      const vision = await makeVisionTranscribe(dataDir)
      const stamp = todayStamp()
      const results: Array<{ name: string; ok: boolean; draftPath?: string; attachmentPath?: string; error?: string }> = []

      for (const f of files) {
        const name = safeName(f.originalname || '未命名')
        const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
        try {
          if (!UPLOAD_EXTS.has(ext)) throw new ParseError(`不支持的文件类型「${ext || name}」（支持 pdf/docx/xlsx/csv/图片/md/txt）`)
          const stem = ext && name.slice(0, -ext.length) ? name.slice(0, -ext.length) : name

          if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
            // 决策 #15：文本笔记直接入树，不走管道
            const destRel = await uniqueRel(kbRoot, targetRel ? `${targetRel}/${name}` : name)
            await mkdir(path.dirname(path.join(kbRoot, destRel)), { recursive: true })
            await writeFile(path.join(kbRoot, destRel), f.buffer, 'utf8')
            results.push({ name, ok: true, draftPath: destRel })
            continue
          }

          // 原件先行入库（解析失败也不丢件）
          const attachRel = `${ATTACH}/${stamp}/${randomBytes(4).toString('hex')}-${name}`
          await mkdir(path.dirname(path.join(kbRoot, attachRel)), { recursive: true })
          await writeFile(path.join(kbRoot, attachRel), f.buffer)

          // 逐个顺序解析（§2.3）；扫描件/图片由 vision 转写，未配置会在此抛 VisionRequiredError
          const parsed = await parseToMarkdown(name, f.buffer, vision ?? undefined)
          if (!parsed) throw new ParseError('解析结果为空')
          const draftName = `${stem}-${stamp}.md`
          const draftRel = await uniqueRel(kbRoot, targetRel ? `${targetRel}/${draftName}` : draftName)
          await mkdir(path.dirname(path.join(kbRoot, draftRel)), { recursive: true })
          const md = buildDraftMarkdown(path.posix.basename(draftRel).replace(/\.md$/, ''), attachRel, parsed.method, parsed.body)
          await writeFile(path.join(kbRoot, draftRel), md, 'utf8')
          results.push({ name, ok: true, draftPath: draftRel, attachmentPath: attachRel })
        } catch (err) {
          const message =
            err instanceof VisionRequiredError
              ? err.message
              : err instanceof ParseError
                ? err.message
                : `解析失败：${(err as Error)?.message ?? '未知错误'}`
          results.push({ name, ok: false, error: message })
        }
      }
      res.json({ ok: results.some((r) => r.ok), results })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // ── 附件区（_attachments）：列表 / 下载 / 删除（决策 #19） ──
  router.get('/attachments', async (_req, res, next) => {
    try {
      const attachRoot = path.join(kbRoot, ATTACH)
      const items: Array<{ path: string; name: string; size: number; mtime: number }> = []
      const stack = [attachRoot]
      while (stack.length) {
        const dir = stack.pop()!
        const entries = (await readdir(dir, { withFileTypes: true }).catch(() => [])) as import('node:fs').Dirent[]
        for (const e of entries) {
          const abs = path.join(dir, e.name)
          const rel = `${ATTACH}/${path.relative(attachRoot, abs).replaceAll('\\', '/')}`
          if (e.isDirectory()) stack.push(abs)
          else {
            const st = await stat(abs).catch(() => null)
            items.push({ path: rel, name: e.name, size: st?.size ?? 0, mtime: st?.mtimeMs ?? 0 })
          }
        }
      }
      items.sort((a, b) => b.mtime - a.mtime)
      res.json({ items })
    } catch (err) {
      next(err)
    }
  })

  router.get('/attachment', async (req, res, next) => {
    try {
      const { rel, abs } = await attachResolve(kbRoot, z.object({ path: z.string() }).parse(req.query).path)
      const st = await stat(abs).catch(() => null)
      if (!st?.isFile()) return void res.status(404).json({ error: 'NOT_FOUND', message: '附件不存在' })
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(rel))}`)
      res.sendFile(abs)
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  // 树内任意文件的原样下载（决策 #14：树内二进制可下载；`_` 区走专用端点）
  router.get('/raw', async (req, res, next) => {
    try {
      const { rel, abs } = await humanResolve(kbRoot, z.object({ path: z.string() }).parse(req.query).path)
      const st = await stat(abs).catch(() => null)
      if (!st?.isFile()) return void res.status(404).json({ error: 'NOT_FOUND', message: '文件不存在' })
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(rel))}`)
      res.sendFile(abs)
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  router.delete('/attachment', async (req, res, next) => {
    try {
      const { rel, abs } = await attachResolve(kbRoot, z.object({ path: z.string() }).parse(req.query).path)
      const st = await stat(abs).catch(() => null)
      if (!st?.isFile()) return void res.status(404).json({ error: 'NOT_FOUND', message: '附件不存在' })
      const references = await countDraftReferences(kbRoot, rel)
      await rm(abs) // 真删不走回收站；引用仅提示不阻拦（决策 #19）
      res.json({ ok: true, references })
    } catch (err) {
      try {
        fail(res, err)
      } catch (e) {
        next(e)
      }
    }
  })

  return router
}
