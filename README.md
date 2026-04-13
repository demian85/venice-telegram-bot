# Venice Bot

Your personal Venice assistant as a Telegram bot.
[Venice.ai](https://venice.ai/) is private and uncensored AI.
It can be added to groups.

## Features

- Chat history with hierarchical memory (daily, weekly, monthly summaries)
- Text completion with tool support
- Vision support for image analysis
- Web search capability
- News delivery with per-chat controls

## Groups

The bot operates with passive group memory capture. All messages are persisted for shared conversation context, but the bot only replies when explicitly mentioned (e.g., `@botname`).

Disabling privacy mode is recommended so every message is captured for memory. Group messages include sender attribution for context.

## Commands

```
start - Show bot overview and status
help - Show operational commands and news status
abort - Abort the current operation
clear - Clear chat history for this chat
info - Show chat scope and subscription details
subscribe - Enable AI news delivery for this chat
unsubscribe - Disable AI news delivery for this chat
interval [seconds] - Show or set news delivery interval
```

In groups, `/subscribe`, `/unsubscribe`, and `/interval` require admin privileges. In private chats, they are self-service.

## Setup

- Create a Venice API Key: https://venice.ai/settings/api
- Create a Telegram bot: https://t.me/BotFather
- Copy `env.sample` to `.env` and fill in the variables
- The bot ships with `config.defaults.json` as the canonical configuration baseline
- Optional: Copy `config.sample.json` to `config.json` to override defaults (model selections, system prompts, news feeds, polling intervals)
- `npm i`

### Development

- Start Redis: `docker compose up redis`
- `npm run start:dev`

### Docker

- `docker compose up`

## News System

The bot automatically collects and delivers news from RSS feeds.

### News Storage

News articles are stored in **Redis** with the following structure:

- **Storage location**: Redis keys with pattern `news:item:{article_id}`
- **Sorted index**: Redis sorted set `news:items` ordered by fetch timestamp
- **Data retention**: Articles expire after **7 days** (TTL = 604800 seconds)
- **No limit on item count**: All articles from the last 7 days are retained

### Default News Feeds

- Planet AI (`https://planet-ai.net/rss.xml`) - Aggregates 30+ AI sources
- Hacker News (`https://news.ycombinator.com/rss`) - Community-curated tech

### How News Works

1. **Collection**: Every 5 minutes (configurable), the bot polls all configured RSS feeds
2. **Relevance scoring**: Each article is scored 0-100 by an LLM for relevance to selected topics
3. **Storage**: Articles scoring above the threshold (default: 70/100) are stored in Redis
4. **Delivery**: Subscribed chats receive relevant articles automatically based on their configured interval
5. **Manual access**: Users can request recent news via `/news [count]` command or by asking the bot

### News Article Format

Each stored article contains:

- `id` - Unique identifier (URL hash)
- `title` - Article headline
- `source` - Feed name
- `url` - Link to original article
- `description` - Article excerpt/summary
- `publishedAt` - Original publication date
- `fetchedAt` - When the bot collected the article
- `relevanceScore` - 0-100 relevance rating

### Per-Chat Controls

- `/subscribe` - Enable automatic news delivery to this chat
- `/unsubscribe` - Disable automatic news delivery
- `/interval [seconds]` - Set delivery cadence (60-86400 seconds, default: 300)
