# Venice Bot

Your personal Venice assistant as a Telegram bot.
[Venice.ai](https://venice.ai/) is private and uncensored AI.
It can be added to groups.

## Features

- Chat history with hierarchical memory (daily, weekly, monthly summaries)
- Text completion with tool support
- Vision support for image analysis
- Web search capability
- AI news delivery with per-chat controls

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
