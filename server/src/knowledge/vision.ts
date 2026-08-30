// 视觉转写（0828-01 §2.1 / 决策 #17）：图片压缩 + 扫描 PDF 逐页渲染 → 视觉模型
// 依赖 sharp（发送前压缩，原件不动）、pdfjs-dist + @napi-rs/canvas（PDF 页渲染，napi 预编译免 node-gyp）。
import type { LanguageModel } from 'ai'
import type { ProviderConfig } from '../agent/types'
import { loadAgentConfig } from '../agent/providerConfig'
import { instantiateProviderModel } from '../agent/modelResolver'

const VISION_IMAGE_MAX_BYTES = 4 * 1024 * 1024 // 视觉 API 单图普遍限 5~10MB，压到 4MB 以下
const VISION_IMAGE_MAX_EDGE = 2000
const DEFAULT_VISION_MAX_PAGES = 20

const VISION_PROMPT =
  '请把这张图片里的内容完整转写为 Markdown：手写或印刷文字逐字保留（保持段落），表格转 Markdown 表格；' +
  '日期/金额/单位等关键信息原样保留。不要添加评论或总结。'

/** 扫描 PDF 逐页转写页数上限（WORKBENCH_KB_VISION_MAX_PAGES 可配，默认 20） */
export function visionMaxPages(): number {
  return Number(process.env.WORKBENCH_KB_VISION_MAX_PAGES || DEFAULT_VISION_MAX_PAGES)
}

/** 从 ai-providers.json 解析视觉模型配置；未配置返回 null（调用方明确拒收，不静默降级） */
export async function resolveVisionProvider(
  dataDir: string,
): Promise<{ provider: ProviderConfig; model: string } | null> {
  const config = await loadAgentConfig(dataDir).catch(() => null)
  const sel = config?.visionModel
  if (!sel) return null
  const provider = config?.providers.find((p) => p.id === sel.providerId)
  if (!provider) return null
  return { provider, model: sel.model }
}

/** sharp 压缩：自动转向、最长边 2000px、质量递降直到 <4MB（只在内存副本上操作，原件不落盘不动） */
async function compressForVision(buf: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const base = () => sharp(buf, { failOn: 'none' }).rotate()
  const meta = await base().metadata()
  let pipeline = base()
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0)
  if (longest > VISION_IMAGE_MAX_EDGE) pipeline = pipeline.resize({ width: VISION_IMAGE_MAX_EDGE, height: VISION_IMAGE_MAX_EDGE, fit: 'inside' })
  let out = await pipeline.jpeg({ quality: 82 }).toBuffer()
  for (let quality = 66; out.length > VISION_IMAGE_MAX_BYTES && quality >= 30; quality -= 12) {
    out = await base().resize({ width: VISION_IMAGE_MAX_EDGE, height: VISION_IMAGE_MAX_EDGE, fit: 'inside' }).jpeg({ quality }).toBuffer()
  }
  return out
}

/** 单次视觉调用：图片 + 提示词 → Markdown 文本 */
async function visionCall(model: LanguageModel, image: Buffer, prompt: string): Promise<string> {
  const { generateText } = await import('ai')
  const r = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', image: new Uint8Array(image) },
          { type: 'text', text: prompt },
        ],
      },
    ],
    maxOutputTokens: 8192,
  })
  return r.text.trim()
}

/** 图片转写函数形态（parse.ts 管道注入用） */
export type VisionTranscribe = (buf: Buffer, filename: string) => Promise<string>

/** 构造图片转写器；未配置视觉模型返回 null */
export async function makeVisionTranscribe(dataDir: string): Promise<VisionTranscribe | null> {
  const found = await resolveVisionProvider(dataDir)
  if (!found) return null
  const model = await instantiateProviderModel(found.provider, found.model)
  return async (buf: Buffer) => visionCall(model, await compressForVision(buf), VISION_PROMPT)
}

/** pdfjs 渲染所需的最小接口（真实类型随 pdf-parse 内嵌版本走，不直接引用其类型包） */
interface PdfPage {
  getViewport(params: { scale: number }): { width: number; height: number }
  render(params: { canvasContext: unknown; viewport: unknown }): { promise: Promise<void> }
  cleanup(): void
}
interface PdfDocument {
  numPages: number
  getPage(n: number): Promise<PdfPage>
  destroy(): Promise<void>
}
interface PdfjsModule {
  GlobalWorkerOptions: { workerSrc: string }
  getDocument(params: { data: Uint8Array; useSystemFonts?: boolean }): { promise: Promise<PdfDocument> }
}

/**
 * 载入 pdfjs（渲染引擎）：直接用 pdf-parse 内嵌的那一份 —— 两个好处：
 * 1) API 与 worker 天然同版本（pdf-parse 的 worker 会占 globalThis，混用根上另一份必报版本错配）；
 * 2) 少装一份 pdfjs-dist。路径经 createRequire 从 pdf-parse 包内解析。
 */
async function loadPdfjs(): Promise<PdfjsModule> {
  const { createRequire } = await import('node:module')
  const path = await import('node:path')
  const req = createRequire(import.meta.url)
  // pdf-parse 的 exports map 不暴露 package.json → 从其主入口（dist/pdf-parse/cjs/index.cjs）反推包目录
  const mainEntry = req.resolve('pdf-parse')
  const inner = createRequire(path.join(path.dirname(mainEntry), '..', '..', '..', 'package.json'))
  const apiPath = inner.resolve('pdfjs-dist/legacy/build/pdf.mjs')
  const workerPath = inner.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
  const pdfjs = (await import(apiPath)) as unknown as PdfjsModule
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath
  return pdfjs
}

/** 扫描件 PDF：逐页渲染成图 → 视觉转写；超页上限截断并在文末注明（决策 #17） */
export async function transcribeScannedPdf(pdfBuf: Buffer, vision: VisionTranscribe): Promise<string> {
  const pdfjs = await loadPdfjs()
  const { createCanvas } = await import('@napi-rs/canvas')

  const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuf), useSystemFonts: true }).promise
  const limit = visionMaxPages()
  const pageCount = Math.min(doc.numPages, limit)
  const chunks: string[] = []
  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const base = page.getViewport({ scale: 1 })
    // 渲染目标：长边约 1600px（下限 1.2 倍防过小）
    const scale = Math.max(1.2, Math.min(2, 1600 / Math.max(base.width, base.height)))
    const viewport = page.getViewport({ scale })
    const canvas = createCanvas(viewport.width, viewport.height)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff' // 扫描页常带透明背景，白底防反色
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport }).promise
    const png = Buffer.from(await canvas.encode('png'))
    const text = await vision(png, `page-${i}.png`)
    chunks.push(`## 第 ${i} 页\n\n${text}`)
    page.cleanup()
  }
  await doc.destroy()
  if (doc.numPages > limit) {
    chunks.push(`> 注：原件共 ${doc.numPages} 页，超过单次转写上限 ${limit} 页，仅转写了前 ${limit} 页。`)
  }
  return chunks.join('\n\n')
}
