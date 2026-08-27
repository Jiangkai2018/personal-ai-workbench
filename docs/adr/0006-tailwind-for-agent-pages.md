# ADR-0006：Agent 新页面局部引入 Tailwind，样式体系双轨

## 背景

本项目 web 端是纯 CSS「纸墨」设计系统，而 assistant-ui/shadcn 生态的现成组件源码全部由 Tailwind class 写成。Agent 板块要拿成品级聊天交互，绕不开这个冲突。

## 决策

**引入 Tailwind v4，作用域仅限 Agent 相关新页面**（Agent 会话页、/admin）；纸墨 token（暖纸底、墨色、朱砂、思源宋体标题）映射进 Tailwind theme 变量做视觉调和。既有页面继续用原 CSS 体系，不做迁移。

## 理由

用 Tailwind 重写一遍流式消息流/工具卡片/thinking 折叠/questionnaire 等交互，成本远高于维护双轨样式。将来若有页面从 Tailwind 迁回纸墨 CSS，属组件级重写而非架构级返工。

## 后果

后续贡献者会看到两套样式并存——这是刻意决定，不要试图"统一"它除非整个仓库达成新共识。
