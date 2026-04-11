# Venice Telegram Bot — AGENTS.md

## Runtime & Tooling

- **Node 24** required (`node >=24.0.0` in `package.json`, `24` in `.nvmrc`)
- **npm** as package manager (`package-lock.json` present)
- **Redis** for session storage, message memory, and job queues
- **Docker Compose** for local development (Redis + app)
- No dedicated lint/format npm scripts — ESLint and Prettier configs are present but invoked via `npx`

## Required Setup

### Env file

Copy `env.sample` to `.env` and fill in:

```
TELEGRAM_BOT_TOKEN=        # From @BotFather
VENICE_API_KEY=            # From venice.ai/settings/api
REDIS_URL=redis://localhost:6379

# Optional: News monitoring configuration
NEWS_POLL_INTERVAL_MINUTES=5
NEWS_RELEVANCE_THRESHOLD=70
DEFAULT_FEEDS=https://planet-ai.net/rss.xml,https://news.ycombinator.com/rss
```

### Optional bot config

Copy `src/bot.config.ts.sample` → `src/bot.config.ts` and override defaults.

### Redis

A running Redis instance is required for session storage and message memory. Start it with:

```
docker compose up redis
```

Or run the full stack: `docker compose up`

## Entrypoints & Boundaries

- `src/index.ts` — app bootstrap (dotenv → config → `Bot.init()`)
- `src/lib/telegram/index.ts` — bot wiring, command handlers, middleware
- `src/lib/redis/` — Redis client and session store
- `src/lib/agent/` — LangChain ReAct agent core
- `src/lib/memory/` — Hierarchical memory system (recent → daily → weekly → monthly)
- `src/lib/news/` — RSS feed monitoring and relevance detection
- `build/` — generated output from `npm run build`; **do not edit directly**

## Trusted Commands

```bash
npm run build      # tsc && resolve-tspaths → build/
npm start          # node build/index.js | pino-pretty
npm run start:dev  # ts-node -r tsconfig-paths/register src/index.ts | pino-pretty
npm run tscheck    # tsc --noEmit --pretty
```

For linting or formatting (no dedicated npm scripts — invoke directly):

```bash
npx eslint .
npx prettier --check .
```

## Architecture Notes

### Single Model Configuration

This bot uses a single Venice AI model. Model selection has been removed in favor of a simplified configuration with one configurable model endpoint.

### News Monitoring

The bot polls configured RSS feeds every 5 minutes (configurable via `NEWS_POLL_INTERVAL_MINUTES`). Articles are scored for relevance using the Venice AI model and forwarded to Telegram groups if they meet the threshold (default: 70/100).

Default feeds:

- Planet AI (`https://planet-ai.net/rss.xml`) — Aggregates 30+ AI sources
- Hacker News (`https://news.ycombinator.com/rss`) — Community-curated tech

### Memory System

Conversations are stored in Redis with hierarchical summarization:

- Recent messages buffer (last 10-20 messages)
- Daily summaries (auto-generated every 24h)
- Weekly summaries (7-day aggregates)
- Monthly summaries (30-day aggregates)

This prevents context window overflow while maintaining conversation history.

## Known Pitfalls

### README is stale on setup filenames

- README says `.env` from `sample.env` → actual file is `env.sample` at repo root
- README says `bot.config.ts.sample` at root → actual path is `src/bot.config.ts.sample`

**Always verify against config/source files, not README.**

### npm test is declared but unverified

`package.json` defines `npm test → jest` but `jest` is absent from `devDependencies`. Do not trust this script until verified.

### No CI or pre-commit hooks

This repo has no `.github/workflows`, `.husky`, or other CI/pre-commit configuration.

### MCP Servers (Future Phase)

MCP (Model Context Protocol) server integration is planned for Phase 2. The agent architecture supports MCP tools but no servers are configured in the initial implementation.
