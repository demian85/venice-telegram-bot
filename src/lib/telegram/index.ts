import { Telegraf, session } from 'telegraf'
import { message } from 'telegraf/filters'
import logger from '@lib/logger'

import { Postgres } from '@telegraf/session/pg'
import { ContextWithSession, Session } from './types'
import commandHandlers from './handlers'
import { chatCompletion } from '@lib/api'
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import { countTokens } from 'gpt-tokenizer'
import { defaultSession } from './defaults'
import { Config } from '@lib/types'
import { generateImageHandler } from './handlers/image'
import { getTextFromCommand } from './util'

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
          return `telegraf:${ctx.chat?.id ?? ctx.from?.id}`
        },
        defaultSession: (_ctx) => defaultSession,
      })
    )

    this.bot.use((ctx, _next) => {
      ctx.chatType = ctx.chat?.type === 'private' ? 'private' : 'group'

      logger.debug(
        {
          message: ctx.message,
          session: ctx.session,
          update: ctx.update,
          chatType: ctx.chatType,
        },
        'Middleware call'
      )

      if (
        !ctx.chat?.type ||
        ['channel', 'supergroup'].includes(ctx.chat?.type)
      ) {
        throw new Error('Chat type not supported')
      }

      const whitelistedUsers = this.config.telegram.whitelistedUsers

      if (
        ctx.chat.type === 'private' &&
        (!ctx.chat?.username ||
          (whitelistedUsers.length > 0 &&
            !whitelistedUsers.includes(ctx.chat?.username)))
      ) {
        throw new Error('Forbidden')
      }

      return _next()
    })

    this.buildCommands()

    this.bot.on(message('text'), async (ctx) => {
      const messageText = ctx.message.text.trim()

      if (!messageText) {
        return ctx.reply(`/help`)
      }

      const isCommand =
        ctx.message.entities?.find((v) => v.type === 'bot_command')?.offset ===
        0

      if (isCommand) {
        return ctx.reply(`Unknown command. /help`)
      }

      const cmd = ctx.session.currentCommand

      if (cmd !== null) {
        const cmdId = cmd.id as keyof typeof commandHandlers
        const handler = commandHandlers?.[cmdId].message[cmd.step]
        if (!handler) {
          return ctx.reply(`/help`)
        }
        return commandHandlers?.[cmdId].message[cmd.step](ctx)
      }

      const isMention = ctx.message.entities?.find(
        (v) =>
          v.type === 'mention' &&
          messageText.substring(0, v.length) ===
            this.config.telegram.botUsername
      )
      const filteredMessageText = isMention
        ? messageText.substring(this.config.telegram.botUsername.length).trim()
        : messageText

      if (ctx.chatType === 'group' && filteredMessageText) {
        const userName =
          ctx.message.from.first_name ?? ctx.message.from.username
        this.addAndTruncateChatHistory(ctx, {
          role: 'user',
          content: `${userName}: ${filteredMessageText}`,
        })
      } else {
        this.addAndTruncateChatHistory(ctx, {
          role: 'user',
          content: filteredMessageText,
        })
      }

      if (
        (ctx.chatType === 'group' && isMention) ||
        ctx.chatType === 'private'
      ) {
        await this.handleTextCompletion(ctx)
      }
    })

    this.bot.on(message('photo'), async (ctx) => {
      if (ctx.session.currentCommand) {
        return ctx.reply(`/help`)
      }

      const photo = ctx.message.photo
      const bestPhoto = photo.find(
        (item) => item.width >= 240 && item.height >= 240
      )

      if (!bestPhoto) {
        if (ctx.chatType === 'private') {
          await ctx.reply(`Photo is too small.`)
        }
        return
      }

      const caption = ctx.message.caption
      const botMention =
        caption &&
        ctx.message.caption_entities?.find(
          (v) =>
            v.type === 'mention' &&
            caption?.substring(0, v.length) === this.config.telegram.botUsername
        )
      const filteredCaption = botMention
        ? caption.substring(botMention.length).trim()
        : caption
      const content: ChatCompletionContentPart[] = filteredCaption
        ? [
            {
              type: 'text',
              text: filteredCaption,
            },
          ]
        : []
      const fileId = bestPhoto.file_id
      const fileLink = await ctx.telegram.getFileLink(fileId)

      content.push({
        type: 'image_url',
        image_url: { url: fileLink.toString() },
      })

      this.addAndTruncateChatHistory(ctx, {
        role: 'user',
        content,
      })

      if (
        (ctx.chatType === 'group' && caption && botMention) ||
        ctx.chatType === 'private'
      ) {
        await this.handleTextCompletion(ctx)
      }
    })

    this.bot.on('callback_query', async (ctx) => {
      const cmd = ctx.session.currentCommand

      if (!cmd) {
        return ctx.answerCbQuery('Invalid callback')
      }

      const cmdId = cmd.id as keyof typeof commandHandlers
      const handler = commandHandlers?.[cmdId].callbackQuery[cmd.step]

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
      logger.info({ config: this.config }, 'Telegram bot is up and running')
    })
  }

  private buildCommands() {
    type CommandContext = Parameters<typeof this.bot.command>[2]

    const commands: Record<string, CommandContext> = {
      help: async (ctx) =>
        await ctx.reply(
          `Available commands: ${Object.keys(commands)
            .map((cmd) => `/${cmd}`)
            .join(', ')}`
        ),
      abort: async (ctx) => {
        ctx.session.currentCommand = null
        await ctx.reply(`Operation aborted`)
      },
      clear: async (ctx) => {
        ctx.session.messages = []
        await ctx.reply(`Chat history deleted. Starting a new chat...`)
      },
      config: async (ctx) => {
        if (ctx.session.currentCommand) {
          ctx.session.currentCommand = null
          await ctx.reply(`Previous command aborted`)
        }
        await commandHandlers.config.message[0](ctx)
      },
      info: async (ctx) => {
        if (ctx.session.currentCommand) {
          ctx.session.currentCommand = null
          await ctx.reply(`Previous command aborted`)
        }
        await ctx.reply(
          `Current selected models are:
-*Text*: [${ctx.session.config.textModel.id}](${ctx.session.config.textModel.model_spec.modelSource})
-*Image*: [${ctx.session.config.imageModel.id}](${ctx.session.config.imageModel.model_spec.modelSource})
-*Code*: [${ctx.session.config.codingModel.id}](${ctx.session.config.codingModel.model_spec.modelSource})`.trim(),
          {
            parse_mode: 'Markdown',
            link_preview_options: { is_disabled: true },
          }
        )
      },
      image: async (ctx) => {
        if (ctx.session.currentCommand) {
          ctx.session.currentCommand = null
          await ctx.reply(`Previous command aborted`)
        }
        const messageText = getTextFromCommand(ctx)

        if (messageText) {
          await generateImageHandler(ctx, messageText)
        } else {
          await commandHandlers.image.message[0](ctx)
        }
      },
    }

    this.bot.start((ctx) => ctx.reply(`Ask me anything!`))

    Object.entries(commands).forEach(([cmd, handler]) => {
      this.bot.command(cmd, handler)
    })
  }

  private async handleTextCompletion(ctx: ContextWithSession): Promise<void> {
    const messages: ChatCompletionMessageParam[] = []

    if (ctx.chatType === 'private' && this.config.ia.privateChatSystemPrompt) {
      messages.push({
        role: 'system',
        content: this.config.ia.privateChatSystemPrompt,
      })
    } else if (
      ctx.chatType === 'group' &&
      this.config.ia.groupChatSystemPrompt
    ) {
      messages.push({
        role: 'system',
        content: this.config.ia.groupChatSystemPrompt,
      })
    }

    messages.push(
      ...this.getTruncatedChatHistory(
        ctx,
        ctx.session.config.textModel.model_spec.availableContextTokens
      )
    )

    await ctx.sendChatAction('typing')

    const completion = await chatCompletion({
      model: ctx.session.config.textModel.id,
      messages,
    })

    if (ctx.chatType === 'private') {
      if (!completion) {
        await ctx.reply(`Error: no response from model`)
        return
      }
      try {
        await ctx.reply(completion, { parse_mode: 'Markdown' })
      } catch (err) {
        await ctx.reply(completion)
      }
    }

    if (ctx.chatType === 'group' && completion && ctx.message) {
      try {
        await ctx.reply(completion, {
          reply_parameters: { message_id: ctx.message.message_id },
          parse_mode: 'Markdown',
        })
      } catch (err) {
        await ctx.reply(completion, {
          reply_parameters: { message_id: ctx.message.message_id },
        })
      }
    }

    if (completion) {
      ctx.session.messages.push({ role: 'assistant', content: completion })
    }
  }

  private addAndTruncateChatHistory(
    ctx: ContextWithSession,
    msgPart: ChatCompletionMessageParam
  ): void {
    ctx.session.messages.push(msgPart)
    // keep the last X messages in session
    ctx.session.messages = ctx.session.messages.slice(
      -this.config.telegram.maxSessionMessages
    )
  }

  private getTruncatedChatHistory(
    ctx: ContextWithSession,
    maxTokens?: number
  ): ChatCompletionMessageParam[] {
    const output: ChatCompletionMessageParam[] = []
    const reversedHistory = [...ctx.session.messages].reverse()
    let tokenCount = 0
    let imageUrlAdded = false

    for (const message of reversedHistory) {
      let contentString = ''
      if (typeof message.content === 'string') {
        contentString = message.content
      } else if (Array.isArray(message.content)) {
        if (imageUrlAdded) {
          continue
        }
        contentString = message.content
          .map((m) =>
            m.type === 'text'
              ? m.text
              : m.type === 'image_url'
                ? m.image_url
                : ''
          )
          .join(' ')
        imageUrlAdded = true
      }
      tokenCount += countTokens(contentString)
      if (tokenCount <= (maxTokens || this.config.ia.defaultMaxTokens)) {
        output.push(message)
      }
    }

    return output.reverse()
  }
}

export default Bot
