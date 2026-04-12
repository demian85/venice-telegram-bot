import assert from 'node:assert/strict'
import test from 'node:test'
import type { Config } from '../src/lib/types'
import { Bot } from '../src/lib/telegram'
import { ChatSubscriptionStore } from '../src/lib/news'
import {
  FakeTelegraf,
  InMemoryRedis,
  createPhotoUpdate,
  createTextUpdate,
} from './test-helpers'

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
      botUsername: '@bot',
      whitelistedUsers: [],
    },
  }

  const bot = new Bot(
    config,
    {
      agentModel: {} as never,
      summarizerModel: {} as never,
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

  assert.deepEqual(agentService.invocations, [
    {
      chatId: 'private:100',
      input: {
        text: 'Hello there',
        shouldInvoke: true,
      },
    },
  ])
  assert.deepEqual(ctx.chatActions, ['typing'])
  assert.equal(ctx.replyLog[0]?.text, 'agent reply')
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

  assert.deepEqual(agentService.persisted, [
    {
      chatId: 'group:-100',
      input: {
        text: 'Alice: Hello team',
        shouldInvoke: false,
      },
    },
  ])
  assert.deepEqual(agentService.invocations, [])
  assert.deepEqual(ctx.replyLog, [])
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

  assert.deepEqual(agentService.invocations, [
    {
      chatId: 'group:-100',
      input: {
        text: 'Alice: help me',
        shouldInvoke: true,
      },
    },
  ])
  assert.deepEqual(ctx.chatActions, ['typing'])
  assert.equal(ctx.replyLog[0]?.text, 'agent reply')
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

  assert.deepEqual(agentService.invocations, [
    {
      chatId: 'private:100',
      input: {
        text: 'Describe it',
        imageUrl: 'https://files.test/large-photo',
        shouldInvoke: true,
      },
    },
  ])
  assert.deepEqual(ctx.chatActions, ['upload_photo'])
  assert.equal(ctx.replyLog[0]?.text, 'agent reply')
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

  assert.deepEqual(agentService.invocations, [])
  assert.deepEqual(agentService.persisted, [
    {
      chatId: 'private:100',
      input: {
        text: 'What is this?',
        imageUrl: 'https://files.test/photo-a',
        shouldInvoke: true,
      },
    },
  ])
  assert.match(
    ctx.replyLog[0]?.text ?? '',
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
  assert.match(helpText, /Operational commands:/)
  assert.match(
    helpText,
    /\/subscribe - enable relevant AI news delivery for this chat/
  )
  assert.match(
    helpText,
    /private chats invoke the agent directly on each text or photo message/
  )
  assert.match(helpText, /self-service/)
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

  assert.equal(
    ctx.replyLog[0]?.text,
    'Only group admins can use /subscribe in groups.'
  )
  assert.equal(await subscriptions.getSubscription('-100'), null)
})
