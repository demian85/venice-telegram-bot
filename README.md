# Venice Bot

Your personal Venice assistant as a telegram bot. It can be added to groups.

**Work in progress...**

## Features

- ✅ Text completion
- ✅ Vision
- ✅ Web search
- ✅ Image creation
- ⌛ Text To Speech
- ⌛ Speech to Text
- ⌛ Fine-tuning
- ⌛ Autonomy

## Setup

- Create an Venice API Key: https://venice.ai/settings/api
- Create a Telegram bot: https://t.me/BotFather
- Create a `.env` file and fill in the variables from `sample.env`
- Optional: Rename `bot.config.ts.sample` to `bot.config.ts` and override the necessary properties
- `npm i`

### Development

- Spin up a Postgres instance
- `npm run start:dev`

### Docker

- `docker compose up`
