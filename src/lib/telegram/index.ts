import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import type { MessageEntity } from 'telegraf/typings/core/types/typegram'
import type { ChatOpenAI } from '@langchain/openai'
import type { Redis } from 'ioredis'
import logger from '@lib/logger'
import { AgentService } from '@lib/agent'
import { allTools } from '@lib/agent/tools'
import {
  ChatSubscriptionStore,
  defaultNewsIntervalSeconds,
  maxNewsIntervalSeconds,
  minNewsIntervalSeconds,
  type NewsChatSubscription,
} from '@lib/news'
import { getRedisClient } from '@lib/redis'
import { getContextChatScope } from './scope'
import { MessageContext, PhotoMessageContext, TelegramContext } from './types'
import { Config } from '@lib/types'
import { formatTelegramMarkdownReply } from './util'

export interface BotModels {
  agentModel: ChatOpenAI
  summarizerModel: ChatOpenAI
}

export interface BotNewsArticle {
  title: string
  url: string
  description?: string
  relevanceScore: number
}

interface NormalizedTelegramIngress {
  text: string
  imageUrl?: string
  shouldInvoke: boolean
}

type BotCommandHandler = (ctx: TelegramContext) => Promise<void> | void

interface BotRuntime {
  telegram: {
    setMyCommands(
      commands: ReadonlyArray<{ command: string; description: string }>
    ): Promise<unknown>
    getFileLink(fileId: string): Promise<URL>
    sendMessage(
      chatId: string,
      text: string,
      extra?: Record<string, unknown>
    ): Promise<unknown>
    getChatMember(chatId: number, userId: number): Promise<{ status: string }>
  }
  use(
    middleware: (
      ctx: TelegramContext,
      next: () => Promise<void>
    ) => Promise<unknown>
  ): void
  on(updateType: unknown, handler: (ctx: any) => Promise<unknown>): void
  start(handler: BotCommandHandler): void
  command(command: string, handler: BotCommandHandler): void
  launch(callback?: () => void): Promise<unknown>
  stop(reason?: string): void
}

export interface BotDependencies {
  telegraf?: BotRuntime
  redis?: Redis
  agentService?: AgentService
  chatSubscriptionStore?: ChatSubscriptionStore
}

export class Bot {
  private config
  private bot: BotRuntime
  private agentService: AgentService | null = null
  private readonly chatSubscriptionStore: ChatSubscriptionStore

  private readonly registeredCommands = [
    {
      command: 'start',
      description: 'Show bot overview and status',
    },
    {
      command: 'help',
      description: 'Show operational commands',
    },
    {
      command: 'abort',
      description: 'Abort the current operation',
    },
    {
      command: 'clear',
      description: 'Clear this chat history',
    },
    {
      command: 'info',
      description: 'Show chat and subscription status',
    },
    {
      command: 'subscribe',
      description: 'Enable AI news delivery',
    },
    {
      command: 'unsubscribe',
      description: 'Disable AI news delivery',
    },
    {
      command: 'interval',
      description: 'Show or set news interval',
    },
  ] as const

  constructor(
    config: Config,
    models: BotModels,
    dependencies: BotDependencies = {}
  ) {
    this.config = config

    this.bot =
      dependencies.telegraf ??
      new Telegraf<TelegramContext>(process.env.TELEGRAM_BOT_TOKEN!)

    const redisClient = dependencies.redis ?? getRedisClient()

    this.agentService =
      dependencies.agentService ??
      new AgentService({
        redis: redisClient,
        agentModel: models.agentModel,
        summarizerModel: models.summarizerModel,
        tools: allTools,
      })
    this.chatSubscriptionStore =
      dependencies.chatSubscriptionStore ??
      new ChatSubscriptionStore(redisClient)

    this.bot.use(async (ctx, next) => {
      const scope = getContextChatScope(ctx)

      if (!scope) {
        throw new Error('Chat type not supported')
      }

      ctx.chatType = scope.chatType
      ctx.chatScope = scope.chatScope

      const whitelistedUsers = this.config.telegram.whitelistedUsers
      const privateChat = ctx.chat?.type === 'private' ? ctx.chat : null

      if (
        privateChat &&
        (!privateChat.username ||
          (whitelistedUsers.length > 0 &&
            !whitelistedUsers.includes(privateChat.username)))
      ) {
        await ctx.reply('Forbidden: username is not whitelisted')
        throw new Error('Forbidden: username is not whitelisted')
      }

      ctx.isMention = this.isMentioned(ctx)
      ctx.parsedMessageText = this.getParsedMessageText(ctx)

      logger.debug(
        {
          message: ctx.message,
          update: ctx.update,
          updateType: ctx.updateType,
          chatType: ctx.chatType,
          chatScope: ctx.chatScope,
          isMention: ctx.isMention,
          parsedMessageText: ctx.parsedMessageText,
        },
        'Middleware call'
      )

      return next()
    })

    this.buildCommands()

    this.bot.on(message('text'), async (ctx) => {
      if (!ctx.message.text.trim()) {
        return ctx.reply('/help')
      }

      const isCommand =
        ctx.message.entities?.find(
          (entity: MessageEntity) => entity.type === 'bot_command'
        )?.offset === 0

      if (isCommand) {
        return ctx.reply('Unknown command. /help')
      }

      await this.handleIncomingMessage(ctx)
    })

    this.bot.on(message('photo'), async (ctx) => {
      await this.handleIncomingMessage(ctx)
    })

    this.bot.on('inline_query', async (ctx) => {
      await ctx.answerInlineQuery([])
    })

    process.once('SIGINT', () => this.bot.stop('SIGINT'))
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'))
  }

  async init() {
    await this.bot.telegram.setMyCommands(this.registeredCommands)
    await this.agentService?.initialize()
    await this.bot.launch(() => {
      logger.info({ config: this.config }, 'Telegram bot is up and running')
    })
  }

  async sendNewsArticle(
    chatId: string,
    article: BotNewsArticle
  ): Promise<void> {
    const lines = [
      '*Relevant AI news*',
      `*${this.escapeMarkdown(article.title)}*`,
      `[Read more](${article.url})`,
      `Relevance score: ${article.relevanceScore}`,
    ]

    if (article.description) {
      lines.splice(2, 0, this.escapeMarkdown(article.description))
    }

    await this.bot.telegram.sendMessage(chatId, lines.join('\n\n'), {
      parse_mode: 'Markdown',
      link_preview_options: {
        is_disabled: false,
      },
    })
  }

  private buildCommands() {
    const commands: Record<string, BotCommandHandler> = {
      help: async (ctx) => {
        await ctx.reply(await this.buildHelpMessage(ctx))
      },
      abort: async (ctx) => {
        await ctx.reply('No interactive operation is running.')
      },
      clear: async (ctx) => {
        await this.agentService?.clearHistory(ctx.chatScope)
        await ctx.reply('Chat history deleted. Starting a new chat...')
      },
      info: async (ctx) => {
        await ctx.reply(await this.buildInfoMessage(ctx))
      },
      subscribe: async (ctx) => {
        if (!(await this.ensureSubscriptionCommandAccess(ctx, 'subscribe'))) {
          return
        }

        const subscription = await this.chatSubscriptionStore.subscribe(
          this.getSubscriptionChatId(ctx)
        )

        await ctx.reply(
          this.buildSubscriptionMutationMessage(
            'News subscription enabled.',
            subscription
          )
        )
      },
      unsubscribe: async (ctx) => {
        if (!(await this.ensureSubscriptionCommandAccess(ctx, 'unsubscribe'))) {
          return
        }

        const subscription = await this.chatSubscriptionStore.unsubscribe(
          this.getSubscriptionChatId(ctx)
        )

        await ctx.reply(
          this.buildSubscriptionMutationMessage(
            'News subscription disabled.',
            subscription
          )
        )
      },
      interval: async (ctx) => {
        if (!(await this.ensureSubscriptionCommandAccess(ctx, 'interval'))) {
          return
        }

        const args = this.getCommandArguments(ctx)

        if (!args) {
          const subscription = await this.getSubscriptionStatus(
            this.getSubscriptionChatId(ctx)
          )

          await ctx.reply(
            [
              `Current news interval: ${this.getSubscriptionIntervalSeconds(subscription)} seconds.`,
              `Subscription status: ${this.getSubscriptionEnabledLabel(subscription)}.`,
              `Use /interval <seconds> to change it (${minNewsIntervalSeconds}-${maxNewsIntervalSeconds}).`,
            ].join('\n')
          )
          return
        }

        const intervalSeconds = Number(args)

        if (!Number.isInteger(intervalSeconds)) {
          await ctx.reply(
            `News interval must be an integer between ${minNewsIntervalSeconds} and ${maxNewsIntervalSeconds} seconds.`
          )
          return
        }

        try {
          const subscription =
            await this.chatSubscriptionStore.setIntervalSeconds(
              this.getSubscriptionChatId(ctx),
              intervalSeconds
            )

          await ctx.reply(
            this.buildSubscriptionMutationMessage(
              `News interval updated to ${subscription.intervalSeconds} seconds.`,
              subscription
            )
          )
        } catch (error) {
          await ctx.reply(
            error instanceof Error
              ? error.message
              : 'Failed to update the news interval.'
          )
        }
      },
    }

    this.bot.start(async (ctx) => {
      await ctx.reply(await this.buildStartMessage(ctx))
    })

    Object.entries(commands).forEach(([cmd, handler]) => {
      this.bot.command(cmd, handler)
    })
  }

  private async handleAgentTextCompletion(ctx: TelegramContext): Promise<void> {
    if (!this.agentService) {
      return
    }

    const normalizedMessage = await this.normalizeIncomingMessage(ctx)

    if (!normalizedMessage) {
      return
    }

    if (!normalizedMessage.shouldInvoke) {
      await this.agentService.persistUserMessage(
        ctx.chatScope,
        normalizedMessage
      )
      return
    }

    if (normalizedMessage.imageUrl && !this.agentService.supportsImageInput()) {
      await this.agentService.persistUserMessage(
        ctx.chatScope,
        normalizedMessage
      )
      await ctx.reply(
        "This bot's main model cannot inspect images yet. I saved your message context, but I cannot answer about the attached image right now."
      )
      return
    }

    await ctx.sendChatAction(
      normalizedMessage.imageUrl ? 'upload_photo' : 'typing'
    )

    try {
      const response = await this.agentService.invokeLive(
        ctx.chatScope,
        normalizedMessage
      )
      await ctx.reply(formatTelegramMarkdownReply(response), {
        parse_mode: 'Markdown',
      })
    } catch (error) {
      logger.error(
        { error, chatScope: ctx.chatScope },
        'Agent completion error'
      )
      await ctx.reply('Sorry, I encountered an error. Please try again.')
    }
  }

  private escapeMarkdown(text: string): string {
    return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1')
  }

  private async handleIncomingMessage(
    ctx: MessageContext | PhotoMessageContext
  ): Promise<void> {
    await this.handleAgentTextCompletion(ctx)
  }

  private getParsedMessageText(ctx: TelegramContext): string | undefined {
    if (ctx.updateType !== 'message' || !ctx.message) {
      return undefined
    }

    const rawMessageText = this.getRawMessageText(ctx)

    if (!rawMessageText) {
      return undefined
    }

    const withoutCommand = this.stripLeadingCommand(
      rawMessageText,
      this.getMessageEntities(ctx)
    )
    const normalizedText = this.stripExplicitBotMentions(withoutCommand)

    if (!normalizedText) {
      return undefined
    }

    if (ctx.chatType !== 'group') {
      return normalizedText
    }

    const userName =
      ctx.message.from.first_name ?? ctx.message.from.username ?? 'User'

    return `${userName}: ${normalizedText}`
  }

  private getRawMessageText(ctx: TelegramContext): string {
    if (ctx.updateType !== 'message' || !ctx.message) {
      return ''
    }

    if ('text' in ctx.message && typeof ctx.message.text === 'string') {
      return ctx.message.text.trim()
    }

    if ('caption' in ctx.message && typeof ctx.message.caption === 'string') {
      return ctx.message.caption.trim()
    }

    return ''
  }

  private getMessageEntities(ctx: TelegramContext): MessageEntity[] {
    if (ctx.updateType !== 'message' || !ctx.message) {
      return []
    }

    if ('entities' in ctx.message && Array.isArray(ctx.message.entities)) {
      return ctx.message.entities
    }

    if (
      'caption_entities' in ctx.message &&
      Array.isArray(ctx.message.caption_entities)
    ) {
      return ctx.message.caption_entities
    }

    return []
  }

  private isMentioned(ctx: TelegramContext): boolean {
    const rawMessageText = this.getRawMessageText(ctx)

    if (!rawMessageText || ctx.chatType !== 'group') {
      return false
    }

    return this.getMessageEntities(ctx).some(
      (entity) =>
        entity.type === 'mention' &&
        rawMessageText.substring(
          entity.offset,
          entity.offset + entity.length
        ) === this.config.telegram.botUsername
    )
  }

  private stripLeadingCommand(text: string, entities: MessageEntity[]): string {
    const commandEntity = entities.find(
      (item) => item.type === 'bot_command' && item.offset === 0
    )

    return commandEntity ? text.substring(commandEntity.length).trim() : text
  }

  private stripExplicitBotMentions(text: string): string {
    if (!this.config.telegram.botUsername) {
      return text.trim()
    }

    const escapedBotUsername = this.config.telegram.botUsername.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )

    return text
      .replace(new RegExp(escapedBotUsername, 'g'), ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private async normalizeIncomingMessage(
    ctx: TelegramContext
  ): Promise<NormalizedTelegramIngress | null> {
    if (ctx.updateType !== 'message' || !ctx.message) {
      return null
    }

    const text = ctx.parsedMessageText?.trim() ?? ''
    const shouldInvoke = ctx.chatType === 'private' || ctx.isMention

    if ('photo' in ctx.message && Array.isArray(ctx.message.photo)) {
      const largestPhoto = ctx.message.photo[ctx.message.photo.length - 1]

      if (!largestPhoto) {
        return text ? { text, shouldInvoke } : null
      }

      const imageUrl = (
        await ctx.telegram.getFileLink(largestPhoto.file_id)
      ).toString()

      return {
        text,
        imageUrl,
        shouldInvoke,
      }
    }

    if (!text) {
      return null
    }

    return {
      text,
      shouldInvoke,
    }
  }

  private async buildStartMessage(ctx: TelegramContext): Promise<string> {
    const subscription = await this.getSubscriptionStatus(
      this.getSubscriptionChatId(ctx)
    )

    return [
      'Venice Bot is ready.',
      this.getIngressSummary(ctx),
      this.getSubscriptionSummary(subscription),
      'Use /help for the operational command list.',
    ].join('\n\n')
  }

  private async buildHelpMessage(ctx: TelegramContext): Promise<string> {
    const subscription = await this.getSubscriptionStatus(
      this.getSubscriptionChatId(ctx)
    )
    const adminScopeNote =
      ctx.chatType === 'group'
        ? 'In groups, /subscribe, /unsubscribe, and /interval require an admin.'
        : 'In private chats, /subscribe, /unsubscribe, and /interval are self-service.'

    return [
      'Operational commands:',
      '/start - show a quick overview for this chat',
      '/help - show commands, ingress behavior, and news status',
      '/abort - abort the current interactive operation',
      '/clear - clear stored conversation history for this chat scope',
      '/info - show chat scope and subscription details',
      '/subscribe - enable relevant AI news delivery for this chat',
      '/unsubscribe - disable relevant AI news delivery for this chat',
      `/interval [seconds] - show or set the news cadence (${minNewsIntervalSeconds}-${maxNewsIntervalSeconds})`,
      '',
      this.getIngressSummary(ctx),
      adminScopeNote,
      this.getSubscriptionSummary(subscription),
    ].join('\n')
  }

  private async buildInfoMessage(ctx: TelegramContext): Promise<string> {
    const subscription = await this.getSubscriptionStatus(
      this.getSubscriptionChatId(ctx)
    )

    return [
      `Chat scope: ${ctx.chatScope}`,
      `Chat type: ${ctx.chatType}`,
      this.getIngressSummary(ctx),
      this.getSubscriptionSummary(subscription),
      `Interval limits: ${minNewsIntervalSeconds}-${maxNewsIntervalSeconds} seconds.`,
    ].join('\n')
  }

  private getIngressSummary(ctx: TelegramContext): string {
    return ctx.chatType === 'private'
      ? 'Ingress: private chats invoke the agent directly on each text or photo message.'
      : 'Ingress: group text and photo messages are persisted for shared memory, and the agent only replies when the bot is explicitly mentioned.'
  }

  private getSubscriptionSummary(
    subscription: NewsChatSubscription | null
  ): string {
    return [
      `News subscription: ${this.getSubscriptionEnabledLabel(subscription)}.`,
      `News interval: ${this.getSubscriptionIntervalSeconds(subscription)} seconds.`,
    ].join('\n')
  }

  private buildSubscriptionMutationMessage(
    heading: string,
    subscription: NewsChatSubscription
  ): string {
    return [heading, this.getSubscriptionSummary(subscription)].join('\n')
  }

  private async ensureSubscriptionCommandAccess(
    ctx: TelegramContext,
    command: 'subscribe' | 'unsubscribe' | 'interval'
  ): Promise<boolean> {
    if (ctx.chatType === 'private') {
      return true
    }

    const chatId = ctx.chat?.id
    const userId = ctx.from?.id

    if (chatId === undefined || userId === undefined) {
      await ctx.reply(`Only group admins can use /${command} in groups.`)
      return false
    }

    try {
      const member = await ctx.telegram.getChatMember(chatId, userId)

      if (member.status === 'administrator' || member.status === 'creator') {
        return true
      }
    } catch (error) {
      logger.warn(
        { error, chatId, userId, command },
        'Failed to verify Telegram admin access'
      )
      await ctx.reply(
        `I could not verify admin access for /${command}. Please try again.`
      )
      return false
    }

    await ctx.reply(`Only group admins can use /${command} in groups.`)
    return false
  }

  private getSubscriptionChatId(ctx: TelegramContext): string {
    return String(ctx.chat?.id)
  }

  private async getSubscriptionStatus(
    chatId: string
  ): Promise<NewsChatSubscription | null> {
    return await this.chatSubscriptionStore.getSubscription(chatId)
  }

  private getSubscriptionEnabledLabel(
    subscription: NewsChatSubscription | null
  ): 'enabled' | 'disabled' {
    return subscription?.enabled ? 'enabled' : 'disabled'
  }

  private getSubscriptionIntervalSeconds(
    subscription: NewsChatSubscription | null
  ): number {
    return subscription?.intervalSeconds ?? defaultNewsIntervalSeconds
  }

  private getCommandArguments(ctx: TelegramContext): string {
    return this.stripExplicitBotMentions(
      this.stripLeadingCommand(
        this.getRawMessageText(ctx),
        this.getMessageEntities(ctx)
      )
    )
  }
}
