# Venice Telegram Bot — AGENTS.md

## Runtime & Tooling

- **Node 24** required (`node >=24.0.0` in `package.json`, `24` in `.nvmrc`)
- **npm** as package manager (`package-lock.json` present)
- **tsx** for development runtime (`npm run start:dev`)
- **Redis** for session storage, message memory, and job queues
- **BullMQ** for news polling and delivery scheduling
- **Docker Compose** for local development (Redis + app)
- No dedicated lint/format npm scripts — ESLint and Prettier configs are present but invoked via `npx`

## Required Setup

### Env file

Copy `env.sample` to `.env` and fill in:

```
TELEGRAM_BOT_TOKEN=        # From @BotFather
REDIS_URL=redis://localhost:6379
LLM_API_KEY=               # From venice.ai/settings/api (or your provider)
```

### Optional bot config

Copy `config.sample.json` to `config.json` and override defaults. All non-secret configuration lives in JSON: model selections, system prompts, news feeds, polling intervals, and relevance thresholds.

### Redis

A running Redis instance is required for session storage and message memory. Start it with:

```
docker compose up redis
```

Or run the full stack: `docker compose up`

## Entrypoints & Boundaries

- `src/index.ts` — app bootstrap (dotenv -> config -> `Bot.init()`)
- `src/lib/telegram/index.ts` — bot wiring, command handlers, middleware
- `src/lib/redis/` — Redis client and session store
- `src/lib/agent/` — LangChain ReAct agent core with three model roles
- `src/lib/memory/` — Hierarchical memory system (recent -> daily -> weekly -> monthly)
- `src/lib/news/` — RSS feed monitoring, relevance detection, and per-chat delivery
- `build/` — generated output from `npm run build`; **do not edit directly**

## Trusted Commands

```bash
npm run build      # tsc && resolve-tspaths -> build/
npm start          # node build/index.js | pino-pretty
npm run start:dev  # tsx -r tsconfig-paths/register src/index.ts | pino-pretty
npm run tscheck    # tsc --noEmit --pretty
```

For linting or formatting (no dedicated npm scripts — invoke directly):

```bash
npx eslint .
npx prettier --check .
```

## Architecture Notes

### Three Model Roles

The bot uses three distinct LLM roles, each configurable via `config.defaults.json` / `config.json`:

1. **Chat Role** (`llm.roles.chat`) — Primary conversational agent. Configure `model`, `supportsVision`, and `systemPrompt`.
2. **Summarizer Role** (`llm.roles.summarizer`) — Memory summarization and context compression. Configure `model`, `supportsVision`, and `systemPrompt`.
3. **News Relevance Role** (`llm.roles.newsRelevance`) — Article relevance scoring for news delivery. Configure `model`, `supportsVision`, and `systemPrompt`.

Role wiring reads from `config.llm.roles` at runtime. Change models without code changes by editing `config.json`.

### Group Behavior and Privacy Mode

In group chats, the bot operates with **passive group memory capture**:

- All text and photo messages are persisted to Redis for shared conversation memory
- The bot only replies when explicitly mentioned (e.g., `@botname`)
- When privacy mode is disabled, every message is captured; when enabled, only mentions trigger the bot
- Group messages are attributed with sender names (`Sender: message`) for context

In private chats, every message invokes the agent directly.

### News Monitoring

The bot polls configured RSS feeds every 5 minutes (configurable via `news.pollIntervalMinutes` in config). Articles are scored for relevance using the news relevance model and forwarded to Telegram groups if they meet the threshold (default: 70/100).

Default feeds:

- Planet AI (`https://planet-ai.net/rss.xml`) — Aggregates 30+ AI sources
- Hacker News (`https://news.ycombinator.com/rss`) — Community-curated tech

### Per-Chat News Controls

Each chat has independent news subscription settings:

- `/subscribe` — Enable AI news delivery for this chat
- `/unsubscribe` — Disable AI news delivery for this chat
- `/interval [seconds]` — Show or set delivery cadence (60-86400 seconds)

In groups, these commands require admin privileges. In private chats, they are self-service.

### Memory System

Conversations are stored in Redis with hierarchical summarization:

- Recent messages buffer (last 10-20 messages)
- Daily summaries (auto-generated every 24h)
- Weekly summaries (7-day aggregates)
- Monthly summaries (30-day aggregates)

This prevents context window overflow while maintaining conversation history. The summarizer model handles all compression tasks.

### Scheduling

News delivery uses BullMQ with two job types:

- `poll-news` — Fetches RSS feeds and scores articles for relevance
- `deliver-news` — Runs every 60 seconds to deliver relevant articles to subscribed chats based on per-chat intervals

## Known Pitfalls

### npm test is declared but unverified

`package.json` defines `npm test -> jest` but `jest` is absent from `devDependencies`. Do not trust this script until verified.

### No CI or pre-commit hooks

This repo has no `.github/workflows`, `.husky`, or other CI/pre-commit configuration.

### MCP Servers (Future Phase)

MCP (Model Context Protocol) server integration is planned for Phase 2. The agent architecture supports MCP tools but no servers are configured in the initial implementation.
