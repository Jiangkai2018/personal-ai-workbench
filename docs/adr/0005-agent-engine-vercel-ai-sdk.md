# ADR-0005：Agent 引擎采用 Vercel AI SDK（而非 Claude Agent SDK）

## 背景

V1.1 要做 Web 版 AI Agent，核心需求之一是**用户可在主流厂商中任选并自行配 API Key**（DeepSeek/GLM/Kimi/Qwen/OpenAI 等）。表面上这是个"类 Claude Code"产品，Claude Agent SDK 似乎是最贴切的选择。

## 决策

Agent 循环基于 **Vercel AI SDK**（`streamText` + 自定义工具 + `stopWhen` 步数上限），厂商接入用官方适配包 + `createOpenAICompatible` 三档混合，配合 `createProviderRegistry` 做「厂商>模型」选择。

## 理由

- Claude Agent SDK 把模型锁定在 Anthropic Messages 协议上，多厂商体验取决于各家兼容层质量，与"任选厂商"的核心诉求相悖
- AI SDK 的 `toolApproval` 内建 human-in-the-loop、`useChat`/assistant-ui 官方桥接包免适配、usage 流可直接喂 token 统计
- 联网搜索经 MCP client 接入（智谱 webSearchPrime 远程 HTTP 优先、MiniMax stdio 兜底），不另造搜索轮子
- 代价：Skill 系统无现成的，改为采用 Anthropic SKILL.md 格式标准自管（见 `data/agent/skills/`）

## 备选（被否原因备忘）

- Claude Agent SDK：Skill/file-tools 白拿但模型锁死
- LangGraph.js：编排能力强但抽象过重，个人规模性价比低
