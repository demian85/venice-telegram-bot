import { test, expect } from 'vitest'
import type { Config } from '../src/lib/types.js'
import { Bot } from '../src/lib/telegram/index.js'
import { ChatSubscriptionStore } from '../src/lib/news/index.js'
import {
  FakeTelegraf,
  InMemoryRedis,
  createPhotoUpdate,
  createTextUpdate,
} from './test-helpers.js'

class StubAgentService {
  readonly persisted: Array<{
    chatId: string
    input: Record<string, unknown>
  }> = []
  readonly invocations: Array<{
    chatId: string
    input: Record<string, unknown>
  }> = []
  readonly clearedScopes: string[] = []

  constructor(
    private readonly imageSupport: boolean,
    private readonly response: string = 'agent reply'
  ) {}

  async initialize(): Promise<void> {}

  supportsImageInput(): boolean {
    return this.imageSupport
  }

  async persistUserMessage(
    chatId: string,
    input: Record<string, unknown>
  ): Promise<void> {
    this.persisted.push({ chatId, input })
  }

  async invokeLive(
    chatId: string,
    input: Record<string, unknown>
  ): Promise<string> {
    this.invocations.push({ chatId, input })
    return this.response
  }

  async clearHistory(chatScope: string): Promise<void> {
    this.clearedScopes.push(chatScope)
  }
}

function createBotHarness(options: { imageSupport?: boolean } = {}) {
  const redis = new InMemoryRedis()
  const telegraf = new FakeTelegraf()
  const subscriptions = new ChatSubscriptionStore(redis.asRedis())
  const agentService = new StubAgentService(options.imageSupport ?? true)
  const config: Config = {
    telegram: {
      botUsername: 'bot',
      whitelistedUsers: [],
    },
    news: {
      topics: ['AI', 'technology'],
    },
  }

  const bot = new Bot(
    config,
    {
      agentModel: {} as never,
      summarizerModel: {} as never,
      chatSystemPrompt: 'You are a helpful assistant',
      supportsVision: options.imageSupport ?? true,
    },
    {
      telegraf: telegraf as never,
      redis: redis.asRedis(),
      agentService: agentService as never,
      chatSubscriptionStore: subscriptions,
    }
  )

  return { bot, redis, telegraf, subscriptions, agentService }
}

test('private text messages invoke the agent directly', async () => {
  const { telegraf, agentService } = createBotHarness()

  const ctx = await telegraf.dispatch(
    createTextUpdate({
      chatId: 100,
      chatType: 'private',
      username: 'alice',
      text: 'Hello there',
    })
  )

  expect(agentService.invocations).toEqual([
    {
      chatId: 'private:100',
      input: {
        text: 'Hello there',
        shouldInvoke: true,
      },
    },
  ])
  expect(ctx.chatActions).toEqual(['typing'])
  expect(ctx.replyLog[0]?.text).toBe('agent reply')
})

test('group text without a mention is persisted for memory without triggering a reply', async () => {
  const { telegraf, agentService } = createBotHarness()

  const ctx = await telegraf.dispatch(
    createTextUpdate({
      chatId: -100,
      chatType: 'group',
      username: 'alice',
      firstName: 'Alice',
      text: 'Hello team',
    })
  )

  expect(agentService.persisted).toEqual([
    {
      chatId: 'group:-100',
      input: {
        text: 'Alice: Hello team',
        shouldInvoke: false,
      },
    },
  ])
  expect(agentService.invocations).toEqual([])
  expect(ctx.replyLog).toEqual([])
})

test('group text with an explicit mention invokes the agent with sender-attributed text', async () => {
  const { telegraf, agentService } = createBotHarness()

  const ctx = await telegraf.dispatch(
    createTextUpdate({
      chatId: -100,
      chatType: 'group',
      username: 'alice',
      firstName: 'Alice',
      text: '@bot help me',
      entities: [{ type: 'mention', offset: 0, length: 4 }],
    })
  )

  expect(agentService.invocations).toEqual([
    {
      chatId: 'group:-100',
      input: {
        text: 'Alice: help me',
        shouldInvoke: true,
      },
    },
  ])
  expect(ctx.chatActions).toEqual(['typing'])
  expect(ctx.replyLog[0]?.text).toBe('agent reply')
})

test('private photos use the live vision path when the model supports image input', async () => {
  const { telegraf, agentService } = createBotHarness({ imageSupport: true })

  const ctx = await telegraf.dispatch(
    createPhotoUpdate({
      chatId: 100,
      chatType: 'private',
      username: 'alice',
      caption: 'Describe it',
      fileIds: ['small-photo', 'large-photo'],
    })
  )

  expect(agentService.invocations).toEqual([
    {
      chatId: 'private:100',
      input: {
        text: 'Describe it',
        imageUrl: 'https://files.test/large-photo',
        shouldInvoke: true,
      },
    },
  ])
  expect(ctx.chatActions).toEqual(['upload_photo'])
  expect(ctx.replyLog[0]?.text).toBe('agent reply')
})

test('private photos persist context and warn when the model does not support vision', async () => {
  const { telegraf, agentService } = createBotHarness({ imageSupport: false })

  const ctx = await telegraf.dispatch(
    createPhotoUpdate({
      chatId: 100,
      chatType: 'private',
      username: 'alice',
      caption: 'What is this?',
      fileIds: ['photo-a'],
    })
  )

  expect(agentService.invocations).toEqual([])
  expect(agentService.persisted).toEqual([
    {
      chatId: 'private:100',
      input: {
        text: 'What is this?',
        imageUrl: 'https://files.test/photo-a',
        shouldInvoke: true,
      },
    },
  ])
  expect(ctx.replyLog[0]?.text ?? '').toMatch(
    /cannot inspect images yet\. I saved your message context/
  )
})

test('help surfaces the current operational command set and self-service news note', async () => {
  const { telegraf } = createBotHarness()

  const ctx = await telegraf.dispatch(
    createTextUpdate({
      chatId: 100,
      chatType: 'private',
      username: 'alice',
      text: '/help',
      entities: [{ type: 'bot_command', offset: 0, length: 5 }],
    })
  )

  const helpText = ctx.replyLog[0]?.text ?? ''
  expect(helpText).toMatch(/Operational commands:/)
  expect(helpText).toMatch(
    /\/subscribe - enable relevant news delivery for this chat/
  )
  expect(helpText).toMatch(
    /private chats invoke the agent directly on each text or photo message/
  )
  expect(helpText).toMatch(/self-service/)
})

test('group subscription commands are rejected for non-admin users', async () => {
  const { telegraf, subscriptions } = createBotHarness()
  telegraf.telegram.getChatMember = async () => ({ status: 'member' })

  const ctx = await telegraf.dispatch(
    createTextUpdate({
      chatId: -100,
      chatType: 'group',
      username: 'alice',
      text: '/subscribe',
      entities: [{ type: 'bot_command', offset: 0, length: 10 }],
    })
  )

  expect(ctx.replyLog[0]?.text).toBe(
    'Only group admins can use /subscribe in groups.'
  )
  expect(await subscriptions.getSubscription('-100')).toBe(null)
})
