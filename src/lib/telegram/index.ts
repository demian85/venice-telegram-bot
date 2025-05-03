import { Telegraf, session } from 'telegraf'
import { message } from 'telegraf/filters'
import logger from '@lib/logger'

import { Postgres } from '@telegraf/session/pg'
import { ContextWithSession, Session } from './types'
import handlers from './handlers'
import { chatCompletion } from '@lib/venice'
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import { countTokens } from 'gpt-tokenizer'
import { defaultSession } from './defaults'
import { Config } from '@lib/types'

export class Bot {
  private config
  private bot

  constructor(config: Config) {
    this.config = config

    this.bot = new Telegraf<ContextWithSession>(process.env.TELEGRAM_BOT_TOKEN!)

    this.bot.use(
      session({
        store: Postgres<Session>({
          host: process.env.PG_HOST,
          port: 5432,
          database: process.env.PG_DB,
          user: process.env.PG_USER,
          password: process.env.PG_PASSWORD,
        }),
        getSessionKey: (ctx) => {
          return `telegraf:${ctx.chat?.id}`
        },
      })
    )

    this.bot.use((ctx, _next) => {
      logger.debug(
        {
          message: ctx.message,
          session: ctx.session,
          update: ctx.update,
          updateType: ctx.updateType,
        },
        'Middleware call'
      )

      ctx.session ??= defaultSession

      if (ctx.chat?.type !== 'private') {
        throw new Error('Bot not allowed in groups')
      }

      const whitelistedUsers = config.whitelistedUsers

      if (
        !ctx.chat?.username ||
        (whitelistedUsers && !whitelistedUsers.includes(ctx.chat?.username))
      ) {
        throw new Error('Forbidden')
      }

      return _next()
    })

    this.bot.start((ctx) => ctx.reply(`Ask me anything!`))

    this.bot.help((ctx) =>
      ctx.reply(`Available commands: /help, /config, /new`)
    )

    this.bot.command('abort', async (ctx) => {
      ctx.session.currentCommand = null
      await ctx.reply(`Operation aborted`)
    })

    this.bot.command('config', async (ctx) => {
      await handlers.config.message[0](ctx)
    })

    this.bot.command('new', async (ctx) => {
      ctx.session.messages = []
      await ctx.reply(`Chat history deleted. Starting a new chat...`)
    })

    this.bot.on(message('text'), async (ctx) => {
      const userMessage = ctx.message.text

      if (!userMessage) {
        return ctx.reply(`/help`)
      }

      const cmd = ctx.session.currentCommand

      if (cmd !== null) {
        const cmdId = cmd.id as keyof typeof handlers
        const handler = handlers?.[cmdId].message[cmd.step]
        if (!handler) {
          return ctx.reply(`/help`)
        }
        return handlers?.[cmdId].message[cmd.step](ctx)
      }

      this.addAndTruncateChatHistory(ctx, {
        role: 'user',
        content: userMessage,
      })

      const completion = await this.handleTextCompletion(ctx)

      if (!completion) {
        return ctx.reply('Error: No response from Venice')
      }

      const params =
        ctx.chat.type === 'private'
          ? {}
          : { reply_parameters: { message_id: ctx.message.message_id } }

      await ctx.reply(completion, params)
    })

    this.bot.on(message('photo'), async (ctx) => {
      const photo = ctx.message.photo
      const fileId = photo[photo.length - 1].file_id
      const fileLink = await ctx.telegram.getFileLink(fileId)
      const caption = ctx.message.caption

      if (ctx.session.currentCommand) {
        return ctx.reply(`/help`)
      }

      const content: ChatCompletionContentPart[] = caption
        ? [
            {
              type: 'text',
              text: caption,
            },
          ]
        : []
      content.push({
        type: 'image_url',
        image_url: { url: fileLink.toString() },
      })
      this.addAndTruncateChatHistory(ctx, {
        role: 'user',
        content,
      })

      const completion = await this.handleTextCompletion(ctx)

      if (!completion) {
        return ctx.reply('Error: No response from Venice')
      }

      const params =
        ctx.chat.type === 'private'
          ? {}
          : { reply_parameters: { message_id: ctx.message.message_id } }

      await ctx.reply(completion, params)
    })

    this.bot.on(message('document'), async (ctx) => {
      const fileId = ctx.message.document.file_id
      const fileLink = await ctx.telegram.getFileLink(fileId)
      const caption = ctx.message.caption

      if (ctx.session.currentCommand) {
        return ctx.reply(`/help`)
      }

      const content: ChatCompletionContentPart[] = caption
        ? [
            {
              type: 'text',
              text: caption,
            },
          ]
        : []
      content.push({
        type: 'image_url',
        image_url: { url: fileLink.toString() },
      })
      this.addAndTruncateChatHistory(ctx, {
        role: 'user',
        content,
      })

      const completion = await this.handleTextCompletion(ctx)

      if (!completion) {
        return ctx.reply('Error: No response from Venice')
      }

      const params =
        ctx.chat.type === 'private'
          ? {}
          : { reply_parameters: { message_id: ctx.message.message_id } }

      await ctx.reply(completion, params)
    })

    this.bot.on('callback_query', async (ctx) => {
      const cmd = ctx.session.currentCommand

      if (!cmd) {
        return ctx.answerCbQuery('Invalid callback')
      }

      const cmdId = cmd.id as keyof typeof handlers
      const handler = handlers?.[cmdId].callbackQuery[cmd.step]

      // @ts-ignore
      if (handler) {
        return handler(ctx)
      }

      return ctx.answerCbQuery('Invalid callback')
    })

    this.bot.on('inline_query', async (ctx) => {
      await ctx.answerInlineQuery([])
    })

    // Enable graceful stop
    process.once('SIGINT', () => this.bot.stop('SIGINT'))
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'))
  }

  async init() {
    await this.bot.launch(() => {
      logger.info('Telegram bot is up and running')
    })
  }

  private async handleTextCompletion(
    ctx: ContextWithSession
  ): Promise<string | null> {
    await ctx.sendChatAction('typing')

    const messages: ChatCompletionMessageParam[] = []
    if (this.config.privateChatSystemPrompt) {
      messages.push({
        role: 'system',
        content: this.config.privateChatSystemPrompt,
      })
    }
    messages.push(
      ...this.getTruncatedChatHistory(
        ctx,
        ctx.session.config.textModel.model_spec.availableContextTokens
      )
    )
    const completion = await chatCompletion({
      model: ctx.session.config.textModel.id,
      messages,
    })

    if (!completion) {
      await ctx.reply('Error: No response from model')
      return null
    }

    ctx.session.messages.push({ role: 'assistant', content: completion })

    return completion
  }

  private addAndTruncateChatHistory(
    ctx: ContextWithSession,
    msgPart: ChatCompletionMessageParam
  ): void {
    ctx.session.messages.push(msgPart)
    // keep the last 100 messages in session
    ctx.session.messages = ctx.session.messages.slice(-100)
  }

  private getTruncatedChatHistory(
    ctx: ContextWithSession,
    maxTokens?: number
  ): ChatCompletionMessageParam[] {
    const output: ChatCompletionMessageParam[] = []
    const reversedHistory = [...ctx.session.messages].reverse()
    let tokenCount = 0

    for (const message of reversedHistory) {
      let contentString = ''
      if (typeof message.content === 'string') {
        contentString = message.content
      } else if (Array.isArray(message.content)) {
        contentString = message.content
          .map((m) =>
            m.type === 'text'
              ? m.text
              : m.type === 'image_url'
                ? m.image_url
                : ''
          )
          .join(' ')
      }
      tokenCount += countTokens(contentString)
      if (tokenCount <= (maxTokens || this.config.defaultMaxTokens)) {
        output.push(message)
      }
    }

    return output.reverse()
  }
}

export default Bot
