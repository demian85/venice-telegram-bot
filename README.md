# AI Telegram Bot

An AI-powered Telegram bot for private chats and group chats, with long-term memory, optional image understanding, and automated news delivery.

The bot is provider-agnostic: any OpenAI-compatible LLM provider can be used by configuring `llm.baseUrl`, `llm.apiKeyEnvVar`, and the role models in `config.json`. If you want private, uncensored AI access out of the box, [Venice.ai](https://venice.ai/) is a good default platform and is what the sample defaults point to.

## What it does

### Private chats

- Every text message goes straight to the AI agent
- Photo messages can be analyzed when the configured chat model supports vision
- Conversation history is stored in Redis and compressed into hierarchical summaries so the bot can keep context over time

### Group chats

- Group text and photo messages are persisted for shared memory
- The bot only replies when it is explicitly mentioned
- Messages are stored with sender attribution, for example `Alice: can you summarize this?`, so shared context stays readable
- News subscription commands are limited to group admins

This makes the bot usable as both a personal assistant in DMs and a passive-memory assistant in team or community groups.

## Features

- Telegram chat agent powered by LangChain + OpenAI-compatible chat models
- Three separate LLM roles: chat, summarizer, and news relevance scoring
- Hierarchical memory with recent context plus daily, weekly, and monthly summaries
- Optional vision support for photo messages
- Tool-enabled responses with built-in calculator, help, and time tools
- Configurable web-search-aware chat role (`supportsWebSearch`)
- RSS news polling, relevance scoring, storage, and per-chat delivery
- Per-chat news topics and delivery cadence
- On-demand recent news retrieval and 24-hour news summaries
- Optional private-chat username whitelist

## Command reference

The bot registers these Telegram commands:

```text
/start                 Show a quick overview for this chat
/help                  Show commands, ingress behavior, and news status
/abort                 Abort the current interactive operation
/clear                 Clear stored conversation history for this chat scope
/info                  Show chat scope and subscription details
/news [count]          Get recent news (1-10 articles, default: 5)
/summary               Summarize the most relevant news from the last 24 hours
/subscribe             Enable relevant news delivery for this chat
/unsubscribe           Disable relevant news delivery for this chat
/interval [seconds]    Show or set the news cadence
/topics [a, b, c]      Show or set news topics for this chat
```

In private chats, subscription commands are self-service. In group chats, `/subscribe`, `/unsubscribe`, `/interval`, and `/topics` require admin access.

## Tech stack

- **Node.js 24**
- **TypeScript**
- **Telegraf** for Telegram bot handling
- **LangChain** with **@langchain/openai** for the agent runtime
- **Redis** for sessions, conversation memory, summaries, and news storage
- **BullMQ** for polling and delivery scheduling
- **tsx** for local development
- **Pino** + `pino-pretty` for logging
- **Vitest** for tests
- **Docker / Docker Compose** for containerized local runs

## Requirements

- Node.js `>=24.0.0`
- npm
- Redis
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An API key for your chosen OpenAI-compatible provider

## Configuration

### 1. Environment variables

Copy `env.sample` to `.env`:

```bash
cp env.sample .env
```

Required values:

```env
TELEGRAM_BOT_TOKEN=
REDIS_URL=redis://localhost:6379
LLM_API_KEY=
LOG_LEVEL=info
```

### 2. Application config

`config.defaults.json` is the baseline configuration shipped with the repo.

To override it, copy `config.sample.json` to `config.json`:

```bash
cp config.sample.json config.json
```

Important config areas:

- `telegram.botUsername` - used for mention handling in groups
- `telegram.whitelistedUsers` - optional allowlist for private chats
- `news.feeds` - RSS feeds to monitor
- `news.pollIntervalMinutes` - how often feeds are polled
- `news.deliveryCheckIntervalSeconds` - how often subscriptions are checked for delivery
- `news.relevanceThreshold` - minimum score to keep or deliver an article
- `news.topics` - default topics used for relevance scoring
- `llm.apiKeyEnvVar` - env var holding the provider API key
- `llm.baseUrl` - OpenAI-compatible base URL
- `llm.roles.*` - separate model/system-prompt settings for chat, summarizer, and news relevance

By default, `config.defaults.json` points to Venice's API base URL, but you can swap that to any compatible provider.

## Running locally

Install dependencies:

```bash
npm install
```

Start Redis only:

```bash
docker compose up redis
```

Run the bot in development mode:

```bash
npm run start:dev
```

Build and run the production build locally:

```bash
npm run build
npm start
```

## Docker

Build and run the full stack:

```bash
docker compose up --build
```

Run in the background:

```bash
docker compose up -d --build
```

Stop containers:

```bash
docker compose down
```

The compose setup starts:

- `redis` - Redis 7 with append-only persistence
- `bot` - the Node 24 application container

## Development commands

```bash
npm run start:dev
npm run build
npm start
npm run tscheck
npm test
npm run lint
npm run lint:fix
npm run format
npm run format:check
```

## How memory works

Conversation state is stored in Redis.

- Recent messages are kept as the live context window
- Daily summaries are generated from raw conversation history
- Weekly summaries are generated from daily summaries
- Monthly summaries are generated from weekly summaries

This keeps the bot context-aware without letting conversation history grow unbounded.

## How news works

The bot continuously monitors configured RSS feeds and stores recent articles in Redis.

1. Feeds are polled on a schedule
2. Each article is scored for relevance with the dedicated news relevance model
3. Relevant articles are stored and indexed in Redis
4. Subscribed chats receive articles according to their own delivery interval
5. Users can also request recent articles manually with `/news` or ask for a digest with `/summary`

Per-chat topic customization is supported through `/topics`, so different chats can receive different filters even when they share the same global feed list.

## Project structure

- `src/index.ts` - bootstrap and service wiring
- `src/lib/telegram/` - Telegram routing, command handling, reply formatting
- `src/lib/agent/` - LangChain agent service and built-in tools
- `src/lib/memory/` - hierarchical memory and summarization
- `src/lib/news/` - feed reading, scoring, storage, subscriptions, scheduling
- `src/lib/redis/` - Redis-backed persistence
- `config.defaults.json` - default runtime config
- `config.sample.json` - example override config
- `env.sample` - environment template

## Notes and gotchas

- If the chat model does not support vision, photo messages are still persisted to memory, but the bot will not answer image-specific questions about them.
- In groups, Telegram privacy mode affects how much context the bot can see. Disabling privacy mode is recommended if you want passive group memory capture for all messages.
- Only one Telegram polling instance should run at a time. If you get a Telegram `409 Conflict`, another bot instance is already connected.
