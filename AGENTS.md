# AI Telegram Bot — AGENTS.md

## Runtime & Tooling

- **Node 24** required (`node >=24.0.0` in `package.json`, `24` in `.nvmrc`)
- **npm** as package manager
- **TypeScript** codebase with **tsx** for dev runtime
- **Redis** required for conversation memory, summaries, subscriptions, and news storage
- **BullMQ** for scheduled news polling and delivery
- **Telegraf** for Telegram bot routing and commands
- **LangChain** + **@langchain/openai** for the tool-enabled agent runtime
- **Vitest** for tests
- **Docker Compose** for local Redis + app orchestration

## Required Setup

### Env file

Copy `env.sample` to `.env` and fill in:

```env
TELEGRAM_BOT_TOKEN=        # From @BotFather
REDIS_URL=redis://localhost:6379
LLM_API_KEY=               # From your OpenAI-compatible provider
LOG_LEVEL=info
```

The code is provider-agnostic. `config.defaults.json` uses Venice's OpenAI-compatible base URL as a suggested default, but any compatible provider can be used by updating `llm.baseUrl`, `llm.apiKeyEnvVar`, and the role model names.

### Optional bot config

Copy `config.sample.json` to `config.json` and override defaults. Runtime config is loaded by deep-merging:

1. `config.defaults.json` (required baseline)
2. `config.json` (optional override)

Arrays replace wholesale; objects merge by key.

### Redis

A running Redis instance is required. Start it with:

```bash
docker compose up redis
```

Or run the full stack:

```bash
docker compose up --build
```

## Entrypoints & Boundaries

- `src/index.ts` — bootstrap: env -> config -> Redis -> models -> tools -> bot -> news scheduler
- `src/lib/telegram/index.ts` — Telegram middleware, message ingress rules, command handlers, outbound replies
- `src/lib/agent/` — LangChain ReAct agent service and built-in tools
- `src/lib/memory/` — hierarchical memory and summarization pipeline
- `src/lib/news/` — feed reading, relevance scoring, storage, subscriptions, and BullMQ scheduling
- `src/lib/redis/` — Redis-backed persistence for conversations and summaries
- `build/` — generated output from `npm run build`; **do not edit directly**

## Trusted Commands

```bash
npm run start:dev   # tsx watch src/index.ts | pino-pretty
npm run build       # tsc && resolve-tspaths
npm start           # node build/index.js | pino-pretty
npm run tscheck     # tsc --noEmit --pretty
npm test            # vitest run
npm run lint        # eslint .
npm run lint:fix    # eslint . --fix
npm run format      # prettier --write .
npm run format:check # prettier --check .
```

## Architecture Notes

### Three LLM roles

The app uses three independently configurable model roles under `config.llm.roles`:

1. **Chat Role** — primary conversational model used by the Telegram bot
2. **Summarizer Role** — compresses memory into daily, weekly, and monthly summaries
3. **News Relevance Role** — scores RSS items against a chat's configured topics at delivery time

Each role exposes:

- `model`
- `supportsVision`
- optional `supportsWebSearch`
- `systemPrompt`

### Private and group behavior

The bot behaves differently by chat type:

#### Private chats

- Every text message invokes the agent directly
- Photo messages invoke the live vision path when the configured chat model supports vision
- If the model does not support vision, the photo message is still persisted to memory and the user gets a graceful limitation message

#### Group chats

- Group text and photo messages are persisted for shared memory
- The bot only replies when explicitly mentioned
- Persisted group content is sender-attributed, for example `Alice: hello`
- `/subscribe`, `/unsubscribe`, `/interval`, and `/topics` require group admin privileges

There is **no app-level privacy-mode toggle in code**. The bot's ingress behavior is fixed by the Telegram routing logic above; Telegram's own privacy-mode setting still affects what updates Telegram sends to the bot.

### Memory system

Conversation state is stored in Redis and exposed to the agent as:

- recent raw messages
- daily summaries
- weekly summaries
- monthly summaries

This keeps the active context window small while preserving long-term continuity.

### Agent tools

Built-in tools currently include:

- calculator
- help
- current time
- recent news retrieval when web search is not enabled for the chat role

Tool wiring happens in `src/lib/agent/tools.ts`.

### News system

The news pipeline is split into scheduled polling and scheduled delivery:

- `poll-news` — fetch RSS feeds and store new articles in Redis (duplicates are skipped; items have a 7-day TTL)
- `deliver-news` — check subscribed chats and score candidate articles against each chat's own topics before delivering

Key config fields live under `news`:

- `feeds`
- `pollIntervalMinutes`
- `deliveryCheckIntervalSeconds`
- `relevanceThreshold` — per-chat delivery threshold
- `maxArticlesPerPoll`
- `topics` — default fallback when a chat has not set custom topics

Per-chat subscriptions can override topics and cadence. Unsubscribed chats do not receive any deliveries regardless of topic settings. `/news` and `/summary` also respect per-chat topics.

### Telegram commands

Current registered commands are defined in `src/lib/telegram/index.ts`:

- `/start`
- `/help`
- `/abort`
- `/clear`
- `/info`
- `/news [count]`
- `/subscribe`
- `/unsubscribe`
- `/interval [seconds]`
- `/topics [comma-separated list]`
- `/summary`

`/debugnews` exists in code as an internal/debug handler but is not part of the registered command list.

## Docker Notes

`docker-compose.yml` runs two services:

- `redis` — Redis 7 with append-only persistence and a healthcheck
- `bot` — Node 24 app built from the local `Dockerfile`

The app container depends on Redis being healthy, consumes `.env`, and mounts `./logs` into `/app/logs`.

## Known Pitfalls

### Telegram 409 conflict

Only one long-polling bot instance should run at a time. If Telegram returns `409 Conflict`, another instance is already connected.

### Group behavior is mention-gated for replies

Do not document or implement group auto-replies unless the routing logic changes. Current behavior is: persist group messages, reply only on explicit mention.

### Provider naming drift

Do not describe this repo as Venice-only. Venice is the default suggested provider in config, but the runtime is designed around OpenAI-compatible providers in general.
