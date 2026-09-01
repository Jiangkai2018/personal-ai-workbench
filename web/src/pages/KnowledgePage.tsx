// 知识库页面（0828-01 §1/§2）：左目录树 + 右阅读/编辑，附件区与回收站以特殊入口呈现
// 人不受 Agent 黑名单限制（决策 #4）；md 渲染复用 markdown.ts（本期含 GFM 表格/围栏代码块）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Folder, FolderOpen, Paperclip, Pencil, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import type { KbAttachment, KbEntry, KbFileData, KbTrashItem, KbUploadResult } from '../api/client'
import { renderMarkdown } from '../lib/markdown'

type Mode = 'read' | 'edit' | 'none'

interface TreeNode {
  name: string
  path: string
  type: 'dir' | 'file'
  binary: boolean
  children: TreeNode[]
}

/** 扁平 entries → 树（entries 的 dir 带 / 结尾） */
function buildTree(entries: KbEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'dir', binary: false, children: [] }
  const dirIndex = new Map<string, TreeNode>([['', root]])
  const ensureDir = (dirPath: string): TreeNode => {
    const existing = dirIndex.get(dirPath)
    if (existing) return existing
    const segs = dirPath.replace(/\/$/, '').split('/')
    const name = segs[segs.length - 1]
    const parentPath = segs.slice(0, -1).join('/')
    const node: TreeNode = { name, path: dirPath, type: 'dir', binary: false, children: [] }
    dirIndex.set(dirPath, node)
    ensureDir(parentPath).children.push(node)
    return node
  }
  for (const e of entries) {
    if (e.type === 'dir') {
      // dir entry 自带 / 结尾：归一化，否则与文件路径推导出的目录 key 不一致 → 重复节点
      ensureDir(e.path.replace(/\/$/, ''))
    } else {
      const segs = e.path.split('/')
      const name = segs[segs.length - 1]
      const parentPath = segs.slice(0, -1).join('/')
      ensureDir(parentPath).children.push({ name, path: e.path, type: 'file', binary: e.binary, children: [] })
    }
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'zh') : a.type === 'dir' ? -1 : 1))
    for (const n of nodes) sort(n.children)
  }
  sort(root.children)
  return root.children
}

function parentDir(path: string): string {
  const segs = path.split('/')
  segs.pop()
  return segs.join('/')
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function KnowledgePage() {
  const [entries, setEntries] = useState<KbEntry[] | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<string>('')
  const [file, setFile] = useState<KbFileData | null>(null)
  const [mode, setMode] = useState<Mode>('none')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  // 新建面板
  const [creating, setCreating] = useState<'file' | 'dir' | null>(null)
  const [newName, setNewName] = useState('')
  // 重命名面板
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameTo, setRenameTo] = useState('')
  // 附件区 / 回收站
  const [showAttach, setShowAttach] = useState(false)
  const [attachments, setAttachments] = useState<KbAttachment[]>([])
  const [showTrash, setShowTrash] = useState(false)
  const [trashItems, setTrashItems] = useState<KbTrashItem[]>([])
  // 上传（决策 #20：落当前目录，面板可改）
  const [uploadResults, setUploadResults] = useState<KbUploadResult[] | null>(null)
  const [uploadDir, setUploadDir] = useState('')
  const pendingFiles = useRef<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  // 移动端抽屉
  const [drawerOpen, setDrawerOpen] = useState(false)
  // 仓库配置（0830-01 决策 #15）：树内隐藏的根 README/CLAUDE 仍可在 UI 编辑
  const [showRepoCfg, setShowRepoCfg] = useState(false)

  const tree = useMemo(() => buildTree(entries ?? []), [entries])

  const refreshTree = useCallback(async () => {
    try {
      const data = await api.kbTree()
      setEntries(data.entries)
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const refreshSides = useCallback(async () => {
    const [att, trash] = await Promise.all([api.kbAttachments().catch(() => ({ items: [] })), api.kbTrash().catch(() => ({ items: [] }))])
    setAttachments(att.items)
    setTrashItems(trash.items)
  }, [])

  useEffect(() => {
    void refreshTree()
    void refreshSides()
  }, [refreshTree, refreshSides])

  const openFile = useCallback(async (path: string) => {
    setSelected(path)
    setDrawerOpen(false)
    setError('')
    try {
      const data = await api.kbFile(path)
      setFile(data)
      setDraft(data.content ?? '')
      setMode(data.binary ? 'none' : 'read')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  const toggleDir = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      setError('')
      try {
        await fn()
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const save = useCallback(() => {
    if (!file?.path) return
    void run(async () => {
      const res = await api.kbSave(file.path!, draft, file.mtime)
      setFile({ ...file, content: draft, mtime: res.mtime })
      setMode('read')
      setNotice('已保存')
      void refreshTree()
    })
  }, [file, draft, run, refreshTree])

  const doCreate = useCallback(() => {
    const name = newName.trim()
    if (!name || !creating) return
    const base = selected ? (entries?.find((e) => e.path === selected)?.type === 'dir' ? selected.replace(/\/$/, '') : parentDir(selected)) : ''
    const target = base ? `${base}/${name}` : name
    void run(async () => {
      if (creating === 'dir') await api.kbMkdir(target)
      else await api.kbSave(target, `# ${name.replace(/\.md$/, '')}\n\n`)
      setCreating(null)
      setNewName('')
      await refreshTree()
      if (creating === 'file') void openFile(target)
    })
  }, [newName, creating, selected, entries, run, refreshTree, openFile])

  const doRename = useCallback(() => {
    if (!renaming) return
    const to = renameTo.trim()
    if (!to) return
    void run(async () => {
      await api.kbRename(renaming, to)
      setRenaming(null)
      await refreshTree()
      if (selected === renaming) {
        if (mode === 'read' || mode === 'edit') void openFile(to)
        else setSelected(to)
      }
    })
  }, [renaming, renameTo, run, refreshTree, selected, mode, openFile])

  const doDelete = useCallback(
    (path: string) => {
      if (!window.confirm(`删除「${path}」？可在回收站恢复。`)) return
      void run(async () => {
        await api.kbDelete(path)
        if (selected === path || selected.startsWith(`${path}/`)) {
          setSelected('')
          setFile(null)
          setMode('none')
        }
        await refreshTree()
        await refreshSides()
        setNotice('已移入回收站')
      })
    },
    [run, refreshTree, refreshSides, selected],
  )

  // ── 上传 ───────────────────────────────────────────
  const doUpload = useCallback(
    async (files: File[], dir: string) => {
      if (!files.length) return
      setError('')
      try {
        const res = await api.kbUpload(dir, files)
        setUploadResults(res.results)
        await Promise.all([refreshTree(), refreshSides()])
      } catch (e) {
        setError((e as Error).message)
      }
    },
    [refreshTree, refreshSides],
  )

  const openUploadPanel = useCallback(
    (files: File[]) => {
      if (!files.length) return
      const dir = selected ? (entries?.find((e) => e.path === selected)?.type === 'dir' ? selected.replace(/\/$/, '') : parentDir(selected)) : ''
      setUploadDir(dir)
      pendingFiles.current = files
      setUploadResults([]) // 先开面板，结果回来即刷新
      void doUpload(files, dir)
    },
    [selected, entries, doUpload],
  )

  // 编辑入口（拖拽 + 按钮）
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      openUploadPanel(Array.from(e.dataTransfer.files))
    },
    [openUploadPanel],
  )

  const rendered = useMemo(() => (mode === 'read' && file?.content ? renderMarkdown(file.content) : ''), [mode, file])

  // ── 树节点渲染 ─────────────────────────────────────
  // 0830-01 §2 八项样式：lucide 图标、左侧朱砂竖条激活态、悬停只变文字色、
  // 行高 py-1.5、缩进 16px、改/删图标化（触屏常显，md 起悬停/聚焦显形）
  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isOpen = expanded.has(node.path)
    const isActive = selected === node.path
    const Icon = node.type === 'dir' ? (isOpen ? FolderOpen : Folder) : node.binary ? Paperclip : FileText
    return (
      <div key={node.path}>
        <div
          className={`group flex items-center gap-1 rounded py-1.5 pr-1 text-[13px] ${
            isActive
              ? 'border-l-2 border-accent bg-paper-deep/50 font-medium text-ink'
              : 'border-l-2 border-transparent text-ink-2 hover:text-ink'
          }`}
          style={{ paddingLeft: depth * 16 + 4 }}
        >
          <button
            type="button"
            data-testid="kb-node"
            className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left"
            onClick={() => (node.type === 'dir' ? toggleDir(node.path) : void openFile(node.path))}
          >
            <Icon size={14} className="shrink-0 text-muted group-hover:text-ink" aria-hidden />
            <span className="truncate">{node.name}</span>
          </button>
          <button
            type="button"
            aria-label={`重命名或移动 ${node.name}`}
            title="重命名 / 移动"
            onClick={() => {
              setRenaming(node.path)
              setRenameTo(node.path)
            }}
            className="shrink-0 rounded p-0.5 text-muted opacity-100 hover:text-accent md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
          >
            <Pencil size={14} aria-hidden />
          </button>
          <button
            type="button"
            aria-label={`删除 ${node.name}`}
            onClick={() => doDelete(node.path)}
            className="shrink-0 rounded p-0.5 text-muted opacity-100 hover:text-danger md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
        {node.type === 'dir' && isOpen && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className="kb-shell flex h-[calc(100dvh-150px)] min-h-[420px] overflow-hidden rounded-[var(--radius)] border border-line bg-paper md:h-[calc(100dvh-108px)]">
      {/* ── 移动端工具条 ── */}
      <div className="absolute inset-x-0 top-[54px] z-10 flex items-center gap-2 border-b border-line bg-card px-3 py-2 md:hidden">
        <button type="button" data-testid="kb-drawer-btn" className="rounded border border-line px-2 py-1 text-xs text-ink" onClick={() => setDrawerOpen((v) => !v)}>
          {drawerOpen ? '收起目录' : '目录'}
        </button>
        <span className="truncate text-xs text-muted">{selected || '知识库'}</span>
      </div>

      {/* ── 左栏：目录树 ── */}
      <aside
        className={`${drawerOpen ? 'fixed inset-x-0 bottom-0 top-[100px] z-20 block bg-paper shadow-lg md:static md:shadow-none' : 'hidden'} w-72 shrink-0 flex-col overflow-y-auto bg-paper p-2 md:flex`}
        data-testid="kb-tree"
      >
        <div className="mb-2 flex flex-wrap gap-1.5 px-1">
          <button
            type="button"
            data-testid="kb-new-file"
            className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent-deep"
            onClick={() => {
              setCreating('file')
              setNewName('')
            }}
          >
            ＋文件
          </button>
          <button
            type="button"
            data-testid="kb-new-dir"
            className="rounded border border-line-strong px-2 py-1 text-xs text-ink hover:border-accent"
            onClick={() => {
              setCreating('dir')
              setNewName('')
            }}
          >
            ＋目录
          </button>
          <button
            type="button"
            data-testid="kb-upload-btn"
            className="rounded border border-line-strong px-2 py-1 text-xs text-ink hover:border-accent"
            onClick={() => fileInput.current?.click()}
          >
            ⬆ 上传
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              openUploadPanel(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </div>

        {creating && (
          <div className="mb-2 rounded border border-line bg-card p-2">
            <p className="mb-1 text-xs text-muted">{creating === 'file' ? '新建文件（当前目录）' : '新建目录（当前目录）'}</p>
            <div className="flex gap-1">
              <input
                data-testid="kb-new-name"
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && doCreate()}
                placeholder={creating === 'file' ? '主题-20260829.md' : '目录名'}
                className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-xs outline-none focus:border-accent"
              />
              <button type="button" data-testid="kb-new-confirm" className="rounded bg-accent px-2 py-1 text-xs text-white" onClick={doCreate}>
                建
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs text-muted" onClick={() => setCreating(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        <nav className="min-h-0 flex-1" aria-label="知识库目录树">
          {entries !== null && tree.length === 0 && <p className="px-2 py-4 text-xs text-muted">知识库还是空的</p>}
          {tree.map((n) => renderNode(n, 0))}
        </nav>

        {/* 附件区 / 回收站 特殊入口 */}
        <div className="mt-2 border-t border-line pt-2">
          <button type="button" data-testid="kb-attach-toggle" className="w-full px-1 py-1 text-left text-xs text-ink2" onClick={() => setShowAttach((v) => !v)}>
            {showAttach ? '▾' : '▸'} 附件区（原件 {attachments.length}）
          </button>
          {showAttach && (
            <div data-testid="kb-attach-list" className="px-1">
              {attachments.length === 0 && <p className="py-1 text-xs text-muted">还没有上传过原件</p>}
              {attachments.map((a) => (
                <div key={a.path} className="group flex items-center gap-1 py-[3px]">
                  <a
                    href={`/api/knowledge/attachment?path=${encodeURIComponent(a.path)}`}
                    className="min-w-0 flex-1 truncate text-xs text-accent underline-offset-2 hover:underline"
                    title={`下载 ${a.name}`}
                  >
                    📎 {a.name}
                  </a>
                  <button
                    type="button"
                    aria-label={`删除原件 ${a.name}`}
                    onClick={() => {
                      if (!window.confirm(`彻底删除原件「${a.name}」？解析稿仍会保留。`)) return
                      void run(async () => {
                        const r = await api.kbDeleteAttachment(a.path)
                        await refreshSides()
                        setNotice(r.references > 0 ? `已删除原件（${r.references} 篇解析稿仍引用它）` : '已删除原件')
                      })
                    }}
                    className="shrink-0 text-xs text-muted opacity-70 hover:text-danger hover:opacity-100"
                  >
                    删
                  </button>
                </div>
              ))}
            </div>
          )}
          <button type="button" data-testid="kb-trash-toggle" className="w-full px-1 py-1 text-left text-xs text-ink2" onClick={() => setShowTrash((v) => !v)}>
            {showTrash ? '▾' : '▸'} 回收站（{trashItems.length}）
          </button>
          {showTrash && (
            <div data-testid="kb-trash-list" className="px-1">
              {trashItems.length === 0 && <p className="py-1 text-xs text-muted">回收站是空的</p>}
              {trashItems.map((t) => (
                <div key={t.path} className="group flex items-center gap-1 py-[3px]">
                  <span className="min-w-0 flex-1 truncate text-xs text-muted" title={`${t.originalPath} · ${humanSize(t.size)}`}>
                    ♻ {t.originalPath}
                  </span>
                  <button
                    type="button"
                    data-testid="kb-restore"
                    onClick={() =>
                      void run(async () => {
                        const r = await api.kbRestore(t.path)
                        await Promise.all([refreshTree(), refreshSides()])
                        setNotice(`已恢复到 ${r.restoredTo}`)
                      })
                    }
                    className="shrink-0 text-xs text-muted opacity-70 hover:text-accent hover:opacity-100"
                  >
                    恢复
                  </button>
                  <button
                    type="button"
                    data-testid="kb-purge"
                    onClick={() => {
                      if (!window.confirm(`彻底删除「${t.originalPath}」？不可恢复！`)) return
                      void run(async () => {
                        await api.kbPurge(t.path)
                        await refreshSides()
                      })
                    }}
                    className="shrink-0 text-xs text-muted opacity-70 hover:text-danger hover:opacity-100"
                  >
                    彻底删
                  </button>
                </div>
              ))}
            </div>
          )}
          {/* 仓库配置（0830-01 决策 #15）：树内隐藏 ≠ 不可达，根 README/CLAUDE 仍可编辑 */}
          <button type="button" data-testid="kb-repo-config" className="w-full px-1 py-1 text-left text-xs text-ink2" onClick={() => setShowRepoCfg((v) => !v)}>
            {showRepoCfg ? '▾' : '▸'} 仓库配置（README / CLAUDE）
          </button>
          {showRepoCfg && (
            <div data-testid="kb-repo-config-list" className="px-2">
              {(['README.md', 'CLAUDE.md'] as const).map((name) => (
                <button key={name} type="button" className="block w-full truncate py-1 text-left text-xs text-accent underline-offset-2 hover:underline" onClick={() => void openFile(name)}>
                  {name}
                </button>
              ))}
              <p className="py-1 text-[11px] leading-relaxed text-muted">树里隐藏的仓库活文档；.gitignore 请用外部编辑器改。</p>
            </div>
          )}
        </div>
      </aside>

      {/* ── 右栏：内容区 ── */}
      <section
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col rounded-[var(--radius)] bg-card shadow-sm pt-[38px] md:pt-0 ${dragOver ? 'kb-drag-over' : ''}`}
        data-testid="kb-content"
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {error && (
          <p role="alert" data-testid="kb-error" className="mx-4 mt-2 rounded bg-danger-soft px-3 py-1.5 text-xs text-danger">
            {error}
            <button type="button" className="ml-2 underline" onClick={() => setError('')}>
              知道了
            </button>
          </p>
        )}
        {notice && (
          <p data-testid="kb-notice" className="mx-4 mt-2 rounded bg-accent-soft px-3 py-1.5 text-xs text-accent-deep">
            {notice}
            <button type="button" className="ml-2 underline" onClick={() => setNotice('')}>
              好的
            </button>
          </p>
        )}

        {renaming && (
          <div className="mx-4 mt-2 rounded border border-line bg-card p-3">
            <p className="mb-1 text-xs text-muted">重命名 / 移动（含目录；目标已存在会被拒绝）</p>
            <div className="flex gap-1">
              <input
                data-testid="kb-rename-input"
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
                className="min-w-0 flex-1 rounded border border-line px-2 py-1 text-xs outline-none focus:border-accent"
              />
              <button type="button" data-testid="kb-rename-confirm" className="rounded bg-accent px-2 py-1 text-xs text-white" onClick={doRename}>
                确定
              </button>
              <button type="button" className="rounded px-2 py-1 text-xs text-muted" onClick={() => setRenaming(null)}>
                取消
              </button>
            </div>
          </div>
        )}

        {/* 上传面板 */}
        {uploadResults !== null && (
          <div className="mx-4 mt-2 rounded border border-line bg-card p-3" data-testid="kb-upload-panel">
            <p className="mb-1 text-xs text-ink2">
              上传到：<span className="text-accent-deep">/{uploadDir || '（根目录）'}</span>
            </p>
            <ul className="space-y-1">
              {uploadResults.map((r) => (
                <li key={r.name} className="flex flex-wrap items-center gap-2 text-xs" data-ok={r.ok}>
                  {r.ok ? (
                    <>
                      <span className="text-accent-deep">✅ {r.name}</span>
                      {r.draftPath && (
                        <button type="button" className="text-accent underline" onClick={() => void openFile(r.draftPath!)}>
                          打开 {r.draftPath}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <span className="text-danger">❌ {r.name}：{r.error}</span>
                      <button
                        type="button"
                        className="underline"
                        onClick={() => {
                          const f = pendingFiles.current.filter((p) => p.name === r.name)
                          void doUpload(f, uploadDir)
                        }}
                      >
                        重试
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="mt-2 text-xs text-muted underline" onClick={() => setUploadResults(null)}>
              关闭
            </button>
          </div>
        )}

        {/* 阅读态 */}
        {mode === 'read' && file && (
          <>
            <div className="flex items-center justify-between border-b border-line bg-card px-4 py-2">
              <p className="min-w-0 truncate text-xs text-muted" data-testid="kb-path">{file.path}</p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  data-testid="kb-edit"
                  className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-deep"
                  onClick={() => setMode('edit')}
                >
                  编辑
                </button>
                <button
                  type="button"
                  aria-label="重命名"
                  className="rounded border border-line-strong px-2 py-1 text-xs text-ink"
                  onClick={() => {
                    setRenaming(file.path!)
                    setRenameTo(file.path!)
                  }}
                >
                  改名/移动
                </button>
                <button type="button" aria-label="删除" className="rounded border border-line-strong px-2 py-1 text-xs text-danger" onClick={() => doDelete(file.path!)}>
                  删除
                </button>
              </div>
            </div>
            <article className="md-body kb-scroll min-h-0 flex-1 overflow-y-auto bg-card px-5 py-4" data-testid="kb-reading">
              <div dangerouslySetInnerHTML={{ __html: rendered }} />
            </article>
          </>
        )}

        {/* 编辑态 */}
        {mode === 'edit' && file && (
          <>
            <div className="flex items-center justify-between border-b border-line bg-card px-4 py-2">
              <p className="min-w-0 truncate text-xs text-muted">编辑 {file.path}</p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  data-testid="kb-save"
                  disabled={busy}
                  className="rounded bg-accent px-3 py-1 text-xs text-white hover:bg-accent-deep disabled:opacity-40"
                  onClick={save}
                >
                  保存
                </button>
                <button
                  type="button"
                  className="rounded border border-line-strong px-2 py-1 text-xs text-ink"
                  onClick={() => {
                    setDraft(file.content ?? '')
                    setMode('read')
                  }}
                >
                  取消
                </button>
              </div>
            </div>
            {error && (
              <div className="mx-4 mt-2 rounded bg-danger-soft px-3 py-2 text-xs text-danger">
                <p>{error}</p>
                <button
                  type="button"
                  data-testid="kb-reload"
                  className="mt-1 underline"
                  onClick={() => {
                    setError('')
                    // 取最新内容后保持在编辑态（用户正要改东西，别把他踢回阅读态）
                    void openFile(file.path!).then(() => setMode('edit'))
                  }}
                >
                  刷新取最新内容
                </button>
              </div>
            )}
            <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-2">
              <textarea
                data-testid="kb-editor"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="kb-scroll min-h-0 w-full resize-none border-r border-line bg-card p-4 font-mono text-[13px] leading-relaxed text-ink outline-none"
              />
              <article className="md-body kb-scroll hidden min-h-0 overflow-y-auto bg-card-warm px-5 py-4 lg:block" aria-hidden>
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(draft) }} />
              </article>
            </div>
          </>
        )}

        {/* 二进制文件 / 空态 */}
        {mode === 'none' && (
          <div className="flex flex-1 items-center justify-center p-6">
            {file?.binary ? (
              <div className="text-center" data-testid="kb-binary">
                <p className="text-4xl">📎</p>
                <p className="mt-2 text-sm text-ink">{file.path}</p>
                <p className="mt-1 text-xs text-muted">二进制原件（{humanSize(file.size ?? 0)}），不支持在线编辑</p>
                <div className="mt-3 flex justify-center gap-2">
                  <a
                    href={`/api/knowledge/raw?path=${encodeURIComponent(file.path)}`}
                    className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-deep"
                  >
                    下载
                  </a>
                  <button type="button" className="rounded border border-line-strong px-3 py-1.5 text-xs text-ink" onClick={() => doDelete(file.path!)}>
                    删除
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <p className="font-serif text-lg text-ink">选择左侧文件阅读</p>
                <p className="mt-1 text-xs text-muted">或把 PDF / Word / Excel / 图片 拖进这里解析入库</p>
              </div>
            )}
          </div>
        )}

        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-accent bg-accent-soft/60">
            <p className="text-sm text-accent-deep">松手即上传到当前目录</p>
          </div>
        )}
      </section>
    </div>
  )
}
