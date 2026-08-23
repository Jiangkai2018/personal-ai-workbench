# Personal AI Workbench

> A local-first personal growth loop: **Idea → Opportunity → Goal → Task → Daily execution → Review → Distill → Feed back into goals**.
> No database, no sign-up page — your data is plain Markdown files in the repo. You own all of it.

[中文文档](README.md)

```
Idea      (3-second capture, no judgment)
  ↓ one-tap promote (auto AI scoring)
Opportunity (5-dim quick scoring)
  ↓ one-tap promote
Goal      (commitment + milestones + progress)
  ↓ break down & schedule
Task      (today / this week / future)
  ↓ check off
Review    (nightly summary, auto-advances goal progress)
  ↓ feeds back
Tomorrow's execution
```

## Features

### Available today

- **Idea capture** — 3-second quick capture on the home page + inbox, growth/maintenance tracks
- **Opportunity scoring** — 5 dimensions × 0–20 = 0–100 total, auto-tiered: ≥80 candidate / 60–79 observing / <60 archived; sliders re-score live
- **AI initial scoring** — configure any Anthropic-compatible endpoint (e.g. Zhipu BigModel) and new opportunities get scored by AI in one tap; idea→opportunity promotion auto-scores. AI advises, you decide
- **Domain analysis reports** — kick off an async deep-dive per opportunity (market / competitors / entry strategy with real account profiles), read it on a dedicated report page
- **Goals** — CRUD, milestones, progress slider; progress auto-advances from reviews
- **Tasks** — four buckets (today / week / future / archive), goal linking & scheduling
- **Nightly review** — daily summary + goal progress update (+10% per completed goal-linked task, idempotent per day+scope), review timeline
- **Direct promotion** — idea→opportunity and opportunity→goal complete in one tap, no approval queue ([ADR-0003](docs/adr/0003-direct-promotion.md))
- **Personal / family scopes** — one-tap switch, tagged and isolated data
- **Finance (SuiShouJi integration)** — WeChat/Alipay bill upload → AI classification → preview → row-by-row import with progress; monthly spending reports (ECharts + AI advice); deterministic compound forecast with milestones
- **Auth** — JWT httpOnly cookie sessions, CLI-managed accounts (no self sign-up), family-co-signed password recovery
- **Storage** — Markdown + YAML frontmatter per entity ([ADR-0001](docs/adr/0001-markdown-as-data-source.md)); no database, git-friendly
- **UI** — "Paper & Ink" design system; responsive from phone dock to desktop side-rail
- **Tests** — 73 unit tests (vitest) + 25 e2e tests (Playwright, isolated data dir)

### On the roadmap

- AI agents: review agent; scoring grounded in your history
- Knowledge distillation: turn review conclusions into searchable notes that feed back into decisions
- Auto git sync: commit data changes automatically (optional push)
- PWA install

## Getting started

```bash
# Requires Node.js ≥ 22
npm install

# Create an account (no self sign-up)
npm run add-user -w server -- --username you --password yourpass --name You --family

# Start backend(3000) + frontend(5173)
npm run dev
```

Open **http://localhost:5173**.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start server + web (dev mode) |
| `npm run build` | Build server + web |
| `npm run test` | Backend unit tests |
| `npm run e2e` | Playwright e2e (isolated data dir) |
| `npm run lint` | ESLint |

## Project layout

```
server/   Express API + domain rules + file storage
web/      React SPA (Vite, pure-CSS design system)
e2e/      Playwright tests (.tmp-data isolation)
data/     ★ all your data (Markdown files; keep it in git)
docs/     docs (user manual, ADRs)
```

## Configuration

| Env var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | backend port |
| `WORKBENCH_DATA_DIR` | `<repo>/data` | data directory |
| `WORKBENCH_JWT_SECRET` | dev default | **change it before exposing to a network** |
| `WORKBENCH_API` | `http://localhost:3000` | dev proxy target |
| `WORKBENCH_AI_API_KEY` | empty | AI scoring key (Anthropic-compatible endpoint); see `.env.example` |

## Design principles

1. **AI advises, you decide** — AI only fills in scores; promotion stays a human click ([ADR-0003](docs/adr/0003-direct-promotion.md)).
2. **Everything is a file** — no database, no vendor lock-in; backup = copy a folder.
3. **Zero-friction capture** — jot ideas in 3 seconds; judge later.
4. **Personal scale first** — file-scan storage is plenty at thousands of entries.

## License

[MIT](LICENSE) © 2026 coder_jk

## Mirrors

- GitHub (primary): https://github.com/Jiangkai2018/personal-ai-workbench
- Gitee (mirror): https://gitee.com/coder_jk/personal-ai-workbench
