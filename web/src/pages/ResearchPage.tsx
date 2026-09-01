// 调研报告区（0901 需求）：托管各平台调研 HTML（web/public/research/ 随构建静态服务）。
// 报告间引用是「同目录相对链接 + #锚点」，点击新 tab 打开原生跳转；
// SPA 本页只是目录页（登录墙后），直链 /research/** 由 nginx 静态服务（决策：接受公开直链）。
interface ReportItem {
  file: string
  title: string
  desc: string
}

interface Group {
  id: string
  name: string
  desc: string
  pending?: boolean
  items: ReportItem[]
}

const GROUPS: Group[] = [
  {
    id: 'jike',
    name: '即刻调研',
    desc: '自媒体 / 副业方向帖子的深度归纳，引用帖全文可从分析内锚点直达',
    items: [
      { file: '/research/jike/即刻自媒体调研-深度分析.html', title: '自媒体调研 · 深度分析', desc: '归纳总结与结论' },
      { file: '/research/jike/即刻自媒体调研-引用帖全文.html', title: '自媒体调研 · 引用帖全文', desc: '被引用的原始帖子（锚点定位）' },
    ],
  },
  {
    id: 'zhihu',
    name: '知乎调研',
    desc: '数据抓取与报告待补充',
    pending: true,
    items: [],
  },
  {
    id: 'reddit',
    name: 'Reddit 调研',
    desc: 'r/sidehustle 等社区的副业讨论数据报告',
    items: [
      { file: '/research/reddit/report.html', title: 'Side Hustle · 报告', desc: '深度分析与归纳' },
      { file: '/research/reddit/highlights.html', title: 'Side Hustle · 精华帖', desc: '引用帖全文（锚点定位）' },
    ],
  },
  {
    id: 'v2ex',
    name: 'V2EX 调研',
    desc: 'V2EX 副业相关主题的数据报告',
    items: [
      { file: '/research/v2ex/report.html', title: 'SideHustle · 报告', desc: '深度分析与归纳' },
      { file: '/research/v2ex/essence.html', title: 'SideHustle · 精华帖', desc: '引用帖全文（锚点定位）' },
    ],
  },
]

export default function ResearchPage() {
  return (
    <div className="page research-page" data-testid="research-page">
      <h2 className="page-title">调研报告</h2>
      <p className="muted research-sub">各平台的调研成果（报告 + 引用帖全文），点击新标签页打开</p>
      <div className="research-groups">
        {GROUPS.map((g) => (
          <section key={g.id} className={`card research-card${g.pending ? ' research-pending' : ''}`} data-testid={`research-card-${g.id}`}>
            <div className="research-card-head">
              <h3 className="card-title">{g.name}</h3>
              {g.pending && <em className="tag">待补充</em>}
            </div>
            <p className="muted research-card-desc">{g.desc}</p>
            {!g.pending && (
              <ul className="research-list">
                {g.items.map((it) => (
                  <li key={it.file}>
                    <a
                      href={it.file}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="research-link"
                      data-testid="research-link"
                    >
                      <span className="research-link-title">{it.title}</span>
                      <span className="muted research-link-desc">{it.desc} ↗</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
