# Venice Bot

Your personal Venice assistant as a telegram bot.
<br>[Venice.ai](https://venice.ai/) is private and uncensored AI.
<br>It can be added to groups.

**Work in progress...**

## Features

- ✅ Chat history
- ✅ Text completion
- ✅ Code completion
- ✅ Image creation
- ✅ Vision
- ✅ Web search
- ⌛ Image enhancements and upscaling
- ⌛ Text To Speech
- ⌛ Speech to Text
- ⌛ Characters
- ⌛ Autonomy

## Groups

It is recommended to disable privacy mode so that every user message is persisted in session.
<br>The bot only autocompletes when mentioned.
<br>Chat history is persisted in a database and kept separate for text and code completions.

## Commands

_Not all of them are implemented yet._

```
help - Show available commands
clear - Clear chat history
abort - Abort current operation
config - Configuration options
info - Configuration details
image - Generate an image
code - Query the coding model
enhance = Enhance an image
tts - Text to speech
```

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
