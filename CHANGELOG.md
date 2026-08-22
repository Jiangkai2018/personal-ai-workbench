# Changelog

本项目的所有显著变更都记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 想法编辑与删除：`PATCH/DELETE /api/ideas/:id`；已转正或存在待审提案的想法拒绝删除（409）

### Fixed

- e2e 断言精确化：确认中心的 toast 与「已处理」标签同文案导致的 strict mode 偶发失败

### Planned

- AI Agent 接入：复盘 Agent、提案 Agent（仍需人工批准）
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
