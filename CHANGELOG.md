# Changelog

本项目的所有显著变更都记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Changed

- **隐私清洗**：代码/文档/测试中的真实姓名、昵称、手机号片段、账本/账户 ID 全部参数化为 .env 配置（`WORKBENCH_SSJ_*`）或通用占位；确认 local_docs 与 data/ 从未入库
- **移除确认中心，转正一键直达**（ADR-0003，取代 ADR-0002）：想法→机会、机会→目标不再需要提案审批
- 想法→机会转正时自动 AI 初评（AI 不可用时以 0 分创建，不阻塞）

### Added

- 财务模块（集成随手记 Web 私有 API）：
  - 账单导入链路：微信 xlsx / 支付宝 csv 解析、规则+AI 分类、预览确认（分类可改/逐行移除）、逐条写入（进度条/停止/断点续传）、三层去重且以远端随手记为唯一事实源、备注取商品名、Web 凭证管理（失效引导重填）
  - 月度报告：流水聚合（分类/成员/日趋势/环比）+ ECharts 图表 + 异步 AI 月报
  - 财务推演：收支档案 + 确定性复利公式（纯函数单测）+ 里程碑 + AI 解读
- 想法编辑与删除：`PATCH/DELETE /api/ideas/:id`；已转正的想法拒绝删除（409）
- AI 初评：`POST /api/opportunities/ai-preview`（表单预填）、`POST /api/opportunities/:id/ai-score`（落盘重评）；`.env` 配置 Anthropic 兼容接口
- 领域分析报告（异步长任务）：`POST /api/opportunities/:id/analyze`（202 + 后台三段式生成：赛道市场/同行格局/切入策略）+ `GET /api/reports(/:id)`；机会页轮询状态，`/reports/:id` 报告页（迷你 markdown 渲染器，零新依赖）；悬挂任务 10 分钟自动落败

### Fixed

- e2e 断言精确化：确认中心的 toast 与「已处理」标签同文案导致的 strict mode 偶发失败

### Planned

- AI Agent 深化：复盘 Agent、结合个人历史的初评增强
- 知识沉淀模块：复盘结论反哺目标与机会决策
- Git 自动同步：数据变更后自动 commit（可选 push）

## [0.1.0] - 2026-08-22

首个可用版本（V0「闭环先转」批次）。

### Added

- 漏斗闭环：想法捕获（3 秒）→ 机会 5 维速评（自动分档）→ 目标（里程碑 + 进度）→ 任务四桶 → 每日执行 → 晚间复盘（幂等，自动推进目标进度）
- 确认中心：承诺类动作（想法→机会、机会→目标）只出提案，人工批准后执行；驳回不生效
- 个人 / 家庭双范围视图与数据隔离
- 鉴权：JWT httpOnly Cookie（7 天）、无自助注册（CLI 建号）、家庭互证找回密码 + 审计日志
- 存储：Markdown + YAML frontmatter 即数据源（ADR-0001），无数据库
- 管理端 CLI：`add-user` / `reset-password`
- Web：「纸墨」设计系统，手机 Dock / 桌面侧轨自适应布局
- 测试：52 个后端单测（vitest）+ 19 个 e2e（Playwright）
- 开源基建：MIT 许可证、GitHub Actions CI、CONTRIBUTING、ADR、双 README（中/英）
