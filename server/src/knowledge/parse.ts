// 上传解析管道（0828-01 §2.1）：按扩展名分发本地解析器，产出 Markdown 正文
// - 文字层文档走本地库（零成本离线）；扫描件 PDF 与图片走视觉模型（vision 依赖注入，见 vision.ts）
// - md/txt 返回 null = 不解析、直接入树（决策 #15）
import * as XLSX from 'xlsx'

export class ParseError extends Error {}

/** 扫描件/图片需要视觉模型而未配置时抛出（调用方给出明确拒收文案，不静默降级） */
export class VisionRequiredError extends ParseError {}

export interface ParsedDoc {
  /** 展示在解析稿「解析方式」行的引擎说明 */
  method: string
  body: string
}

/** 允许上传的扩展名白名单（小写含点） */
export const UPLOAD_EXTS = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.csv', '.jpg', '.jpeg', '.png', '.webp', '.md', '.markdown', '.txt'])

/** 视觉转写依赖（T5 实现）：给定图片字节与文件名 → 转写文字 */
export type VisionTranscribe = (buf: Buffer, filename: string) => Promise<string>

/** mammoth 的 CJS/ESM 双形态互操作（其类型导出不带 default） */
type MammothModuleNS = {
  convertToMarkdown?: (input: { buffer: Buffer }) => Promise<{ value: string }>
  default?: { convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string }> }
}

/** 二维表 → Markdown 表格（首行当表头） */
function rowsToMdTable(rows: string[][]): string {
  if (!rows.length) return '（空表）'
  const width = Math.max(...rows.map((r) => r.length))
  const norm = rows.map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')))
  const header = norm[0]
  const sep = Array.from({ length: width }, () => '---')
  const body = norm.slice(1)
  return ['| ' + header.join(' | ') + ' |', '| ' + sep.join(' | ') + ' |', ...body.map((r) => '| ' + r.join(' | ') + ' |')].join('\n')
}

/**
 * CSV 手动解码：SheetJS 无 BOM 时按 cp1252 解码会弄乱中文；先试 UTF-8（严格）、
 * 失败退 GBK（Node 内置 ICU 支持）、再退回字节流让 SheetJS 兜底。
 */
async function decodeCsv(buf: Buffer): Promise<{ data: string | Buffer }> {
  const utf8 = new TextDecoder('utf-8', { fatal: true })
  try {
    return { data: utf8.decode(buf) }
  } catch {
    try {
      return { data: new TextDecoder('gb18030', { fatal: true }).decode(buf) }
    } catch {
      return { data: buf }
    }
  }
}

async function sheetToMd(buf: Buffer, isCsv: boolean): Promise<string> {
  const input = isCsv ? await decodeCsv(buf) : { data: buf }
  const wb = XLSX.read(input.data, { type: isCsv && typeof input.data === 'string' ? 'string' : 'buffer', raw: false })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], { header: 1, raw: false, defval: '' })
    if (!isCsv) parts.push(`## ${name}\n\n`)
    parts.push(rowsToMdTable(rows.map((r) => (r as unknown[]).map((c) => String(c ?? '')))))
    parts.push('\n')
  }
  return parts.join('\n')
}

/** 扫描件判定：抽出文本过短视为无文字层 */
function hasTextLayer(text: string): boolean {
  return text.replace(/\s+/g, '').length >= 20
}

export async function parseToMarkdown(filename: string, buf: Buffer, vision?: VisionTranscribe): Promise<ParsedDoc | null> {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  switch (ext) {
    case '.md':
    case '.markdown':
    case '.txt':
      return null
    case '.csv':
      return { method: 'SheetJS 表格转换', body: await sheetToMd(buf, true) }
    case '.xlsx':
    case '.xls':
      return { method: 'SheetJS 逐 sheet 表格', body: await sheetToMd(buf, false) }
    case '.docx': {
      type MammothApi = { convertToMarkdown(input: { buffer: Buffer }): Promise<{ value: string }> }
      const mod = (await import('mammoth')) as unknown as MammothModuleNS
      const mammoth = (mod.convertToMarkdown ? mod : mod.default) as MammothApi
      const { value } = await mammoth.convertToMarkdown({ buffer: buf })
      return { method: 'mammoth 转 Markdown', body: value }
    }
    case '.pdf': {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: new Uint8Array(buf) })
      try {
        const r = await parser.getText()
        const text = r.text
          .split('\n')
          .filter((l) => !/^--\s*\d+\s+of\s+\d+\s*--$/.test(l.trim())) // 去掉 pdf-parse 2.x 的页分隔行
          .join('\n')
          .trim()
        if (!hasTextLayer(text)) {
          // 扫描件：逐页渲染成图 → 视觉模型（未配置则明确拒收）
          if (!vision) throw new VisionRequiredError('该 PDF 没有文字层（扫描件），需要配置视觉模型才能解析；可先拍照后按图片上传')
          const { transcribeScannedPdf } = await import('./vision')
          return { method: '视觉模型逐页转写', body: await transcribeScannedPdf(buf, vision) }
        }
        return { method: 'pdf 文字层', body: text }
      } finally {
        await parser.destroy()
      }
    }
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.webp': {
      if (!vision) throw new VisionRequiredError('图片解析需要配置视觉模型（后台 ai-providers.json 的 visionModel）')
      const text = await vision(buf, filename)
      return { method: '视觉模型转写', body: text }
    }
    default:
      throw new ParseError(`不支持的文件类型：${ext || filename}`)
  }
}

/** 解析稿头部（§2.2 存储协议）：标题 + 来源原件 + 解析方式 */
export function buildDraftMarkdown(stem: string, sourceRel: string, method: string, body: string): string {
  const date = new Date().toISOString().slice(0, 10)
  return `# ${stem}\n\n> 来源原件：${sourceRel}\n> 解析方式：${method} ｜ 上传：${date}\n\n${body.trim()}\n`
}
