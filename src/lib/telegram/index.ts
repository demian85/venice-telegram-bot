import { Telegraf, session } from 'telegraf'
import { message } from 'telegraf/filters'
import logger from '@lib/logger'

import { Redis } from '@telegraf/session/redis'
import { ContextWithSession, MessageContext, Session } from './types'
import commandHandlers from './handlers'
import { chatCompletion } from '@lib/api'
import {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions'
import { countTokens } from 'gpt-tokenizer'
import { defaultSession } from './defaults'
import { Config, ModelData, TextCompletionResponse } from '@lib/types'
import { generateImageHandler } from './handlers/image'
import { formatWebCitations, fullMarkdown2TgMarkdown } from './util'
import { AgentService } from '@lib/agent'
import { createVeniceModel } from '@lib/agent/model'
import { allTools } from '@lib/agent/tools'
import { getRedisClient } from '@lib/redis'

export class Bot {
  private config
  private bot
  private agentService: AgentService | null = null

  constructor(config: Config) {
    this.config = config

    this.bot = new Telegraf<ContextWithSession>(process.env.TELEGRAM_BOT_TOKEN!)

    const redisClient = getRedisClient()

    this.bot.use(
      session({
        store: Redis<Session>({
          url: process.env.REDIS_URL || 'redis://localhost:6379',
        }),
        getSessionKey: (ctx) => {
          return `telegraf:${ctx.chat?.id ?? ctx.from?.id}`
        },
        defaultSession: (_ctx) => defaultSession,
      })
    )

    this.agentService = new AgentService({
      redis: redisClient,
      model: createVeniceModel(),
      tools: allTools,
    })

    this.bot.use(async (ctx, _next) => {
      if (ctx.chat?.type !== 'private' && ctx.chat?.type !== 'group') {
        throw new Error('Chat type not supported')
      }

      ctx.chatType = ctx.chat?.type === 'private' ? 'private' : 'group'

      const whitelistedUsers = this.config.telegram.whitelistedUsers

      if (
        ctx.chat.type === 'private' &&
        (!ctx.chat?.username ||
          (whitelistedUsers.length > 0 &&
            !whitelistedUsers.includes(ctx.chat?.username)))
      ) {
        await ctx.reply('Forbidden: username is not whitelisted')
        throw new Error('Forbidden: username is not whitelisted')
      }

      if (ctx.updateType === 'message' && ctx.message) {
        const messageCtx = ctx as MessageContext
        const commandEntity = messageCtx.message.entities?.find(
          (item) => item.type === 'bot_command' && item.offset === 0
        )
        const rawMessageText = messageCtx.message.text ?? ''
        const isMention = !!messageCtx.message.entities?.find(
          (v) =>
            v.type === 'mention' &&
            rawMessageText.substring(v.offset, v.length) ===
              this.config.telegram.botUsername
        )

        ctx.isMention = isMention

        if (rawMessageText) {
          const messageText = commandEntity
            ? rawMessageText.substring(commandEntity.length).trim()
            : rawMessageText.trim()

          const userName =
            messageCtx.message.from.first_name ??
            messageCtx.message.from.username
          const parsedMessageText = isMention
            ? messageText
                .substring(this.config.telegram.botUsername.length)
                .trim()
            : messageText

          ctx.parsedMessageText =
            ctx.chatType === 'group' && parsedMessageText
              ? `${userName}: ${parsedMessageText}`
              : parsedMessageText
        }
      }

      logger.debug(
        {
          message: ctx.message,
          session: ctx.session,
          update: ctx.update,
          updateType: ctx.updateType,
          chatType: ctx.chatType,
          isMention: ctx.isMention,
          parsedMessageText: ctx.parsedMessageText,
        },
        'Middleware call'
      )

      return _next()
    })

    this.buildCommands()

    this.bot.on(message('text'), async (ctx) => {
      if (!ctx.message.text.trim()) {
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

      if (ctx.parsedMessageText) {
        this.addAndTruncateTextChatHistory(ctx, {
          role: 'user',
          content: ctx.parsedMessageText,
        })
      }

      if (
        (ctx.chatType === 'group' && ctx.isMention) ||
        ctx.chatType === 'private'
      ) {
        await this.handleAgentTextCompletion(ctx)
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

      this.addAndTruncateTextChatHistory(ctx, {
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

    process.once('SIGINT', () => this.bot.stop('SIGINT'))
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'))
  }

  async init() {
    await this.agentService?.initialize()
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
        await this.agentService?.clearHistory(ctx.chat?.id?.toString() || '')
        ctx.session.textModelHistory = []
        ctx.session.codeModelHistory = []
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
        const model = ctx.session.config.model || ctx.session.config.textModel
        await ctx.reply(
          `Current model: [${model?.id}](${model?.model_spec.modelSource})`.trim(),
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
        if (ctx.parsedMessageText) {
          await generateImageHandler(ctx, ctx.parsedMessageText)
        } else {
          await commandHandlers.image.message[0](ctx)
        }
      },
      code: async (ctx) => {
        if (ctx.session.currentCommand) {
          ctx.session.currentCommand = null
          await ctx.reply(`Previous command aborted`)
        }
        if (!ctx.parsedMessageText) {
          return ctx.reply('Invalid specifications')
        }

        this.addAndTruncateCodeChatHistory(ctx, {
          role: 'user',
          content: ctx.parsedMessageText,
        })
        await this.handleCodeCompletion(ctx)
      },
    }

    this.bot.start((ctx) => ctx.reply(`Ask me anything!`))

    Object.entries(commands).forEach(([cmd, handler]) => {
      this.bot.command(cmd, handler)
    })
  }

  private async handleAgentTextCompletion(
    ctx: ContextWithSession
  ): Promise<void> {
    const chatId = ctx.chat?.id?.toString()
    if (!chatId || !this.agentService) {
      return
    }

    await ctx.sendChatAction('typing')

    try {
      const response = await this.agentService.invoke(
        chatId,
        ctx.parsedMessageText || ''
      )
      await ctx.reply(response, { parse_mode: 'Markdown' })
    } catch (error) {
      logger.error({ error, chatId }, 'Agent completion error')
      await ctx.reply('Sorry, I encountered an error. Please try again.')
    }
  }

  private async handleTextCompletion(ctx: ContextWithSession): Promise<void> {
    const model = ctx.session.config.model || ctx.session.config.textModel
    if (!model) {
      await ctx.reply(
        'No model configured. Please use /config to select a model.'
      )
      return
    }
    const messages = this.getBaseChatHistory(ctx)
    const systemPromptText = messages?.[0].content?.toString() ?? ''
    messages.push(
      ...this.getTruncatedChatHistory(
        ctx.session.textModelHistory,
        model,
        -countTokens(systemPromptText)
      )
    )

    await ctx.sendChatAction('typing')

    const completionResponse = await chatCompletion({
      model: model.id,
      messages,
      venice_parameters: {
        enable_web_search: 'auto',
        strip_thinking_response: true,
      },
    })
    const completionText = completionResponse.choices?.[0].message.content

    await this.replyWithCitations(ctx, completionResponse)

    if (completionText) {
      ctx.session.textModelHistory.push({
        role: 'assistant',
        content: completionText,
      })
    }
  }

  private async handleCodeCompletion(ctx: ContextWithSession): Promise<void> {
    const model = ctx.session.config.codingModel || ctx.session.config.model
    if (!model) {
      await ctx.reply(
        'No model configured. Please use /config to select a model.'
      )
      return
    }
    const messages = this.getBaseChatHistory(ctx)
    const systemPromptText = messages?.[0].content?.toString() ?? ''
    messages.push(
      ...this.getTruncatedChatHistory(
        ctx.session.codeModelHistory,
        model,
        -countTokens(systemPromptText)
      )
    )

    await ctx.sendChatAction('typing')

    const completionResponse = await chatCompletion({
      model: model.id,
      messages,
      venice_parameters: {
        enable_web_search: model.model_spec.capabilities?.supportsWebSearch
          ? 'auto'
          : undefined,
        strip_thinking_response:
          model.model_spec.capabilities?.supportsReasoning,
      },
    })
    const completionText = completionResponse.choices?.[0].message.content

    await this.replyWithCitations(ctx, completionResponse)

    if (completionText) {
      ctx.session.codeModelHistory.push({
        role: 'assistant',
        content: completionText,
      })
    }
  }

  private async replyWithCitations(
    ctx: ContextWithSession,
    completionResponse: TextCompletionResponse
  ): Promise<void> {
    const completionText = completionResponse.choices?.[0].message.content

    if (ctx.chatType === 'private') {
      await ctx.reply(
        `${fullMarkdown2TgMarkdown(completionText ?? '')}${formatWebCitations(completionResponse)}`,
        { parse_mode: 'Markdown' }
      )
    } else if (ctx.chatType === 'group') {
      await ctx.reply(
        `${fullMarkdown2TgMarkdown(completionText ?? '')}${formatWebCitations(completionResponse)}`,
        { parse_mode: 'Markdown' }
      )
    }
  }

  private getBaseChatHistory(
    ctx: ContextWithSession
  ): ChatCompletionMessageParam[] {
    const userName = ctx.from?.first_name ?? ctx.from?.username ?? 'User'
    const isGroup = ctx.chatType === 'group'
    const systemPrompt = isGroup
      ? this.config.ia.groupChatSystemPrompt.replace('', userName)
      : this.config.ia.privateChatSystemPrompt.replace('', userName)

    return [{ role: 'system', content: systemPrompt }]
  }

  private addAndTruncateTextChatHistory(
    ctx: ContextWithSession,
    message: ChatCompletionMessageParam
  ): void {
    ctx.session.textModelHistory.push(message)
    const maxLength = this.config.telegram.maxSessionMessages
    if (ctx.session.textModelHistory.length > maxLength) {
      ctx.session.textModelHistory =
        ctx.session.textModelHistory.slice(-maxLength)
    }
  }

  private addAndTruncateCodeChatHistory(
    ctx: ContextWithSession,
    message: ChatCompletionMessageParam
  ): void {
    ctx.session.codeModelHistory.push(message)
    const maxLength = this.config.telegram.maxSessionMessages
    if (ctx.session.codeModelHistory.length > maxLength) {
      ctx.session.codeModelHistory =
        ctx.session.codeModelHistory.slice(-maxLength)
    }
  }

  private getTruncatedChatHistory(
    history: ChatCompletionMessageParam[],
    model: ModelData,
    tokenOffset: number
  ): ChatCompletionMessageParam[] {
    const maxTokens = model.model_spec.availableContextTokens

    if (!maxTokens) {
      return history
    }

    const availableTokens = maxTokens + tokenOffset
    const result: ChatCompletionMessageParam[] = []
    let currentTokens = 0

    for (let i = history.length - 1; i >= 0; i--) {
      const message = history[i]
      const content = message.content?.toString() ?? ''
      const tokens = countTokens(content)

      if (currentTokens + tokens > availableTokens) {
        break
      }

      currentTokens += tokens
      result.unshift(message)
    }

    return result
  }
}
