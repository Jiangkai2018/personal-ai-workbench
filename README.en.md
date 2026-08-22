# Personal AI Workbench

> A local-first personal growth loop: **Idea → Opportunity → Goal → Task → Daily execution → Review → Distill → Feed back into goals**.
> No database, no sign-up page — your data is plain Markdown files in the repo. You own all of it.

[中文文档](README.md)

```
Idea      (3-second capture, no judgment)
  ↓ promote ✋ requires human approval
Opportunity (5-dim quick scoring)
  ↓ promote ✋ requires human approval
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
- **Goals** — CRUD, milestones, progress slider; progress auto-advances from reviews
- **Tasks** — four buckets (today / week / future / archive), goal linking & scheduling
- **Nightly review** — daily summary + goal progress update (+10% per completed goal-linked task, idempotent per day+scope), review timeline
- **Confirmation center** — promotions (idea→opportunity, opportunity→goal) are proposals only; humans approve before any file operation
- **Personal / family scopes** — one-tap switch, tagged and isolated data
- **Auth** — JWT httpOnly cookie sessions, CLI-managed accounts (no self sign-up), family-co-signed password recovery
- **Storage** — Markdown + YAML frontmatter per entity ([ADR-0001](docs/adr/0001-markdown-as-data-source.md)); no database, git-friendly
- **UI** — "Paper & Ink" design system; responsive from phone dock to desktop side-rail
- **Tests** — 52 unit tests (vitest) + 19 e2e tests (Playwright, isolated data dir)

### On the roadmap

- AI agents: review agent & proposal agent (still gated by human approval — [ADR-0002](docs/adr/0002-proposal-confirmation-gate.md))
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

## Design principles

1. **Commitments require human approval** — agents can only propose.
2. **Everything is a file** — no database, no vendor lock-in; backup = copy a folder.
3. **Zero-friction capture** — jot ideas in 3 seconds; judge later.
4. **Personal scale first** — file-scan storage is plenty at thousands of entries.

## License

[MIT](LICENSE) © 2026 coder_jk

## Mirrors

- GitHub (primary): https://github.com/Jiangkai2018/personal-ai-workbench
- Gitee (mirror): https://gitee.com/coder_jk/personal-ai-workbench
