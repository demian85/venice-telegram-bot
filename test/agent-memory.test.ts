import assert from 'node:assert/strict'
import test from 'node:test'
import { AgentService } from '../src/lib/agent'
import { SummaryStore } from '../src/lib/memory'
import { buildPersistedTextShadow } from '../src/lib/agent/content'
import { InMemoryRedis } from './test-helpers'

function createStubModel(modelName: string) {
  return {
    modelName,
    invoke: async () => ({ content: 'summary text' }),
  } as never
}

test('vision-capable role wiring keeps live image input rich and persists a text shadow', async () => {
  const redis = new InMemoryRedis()
  const agentInvocations: unknown[] = []
  const service = new AgentService({
    redis: redis.asRedis(),
    agentModel: createStubModel('gpt-5.4-mini'),
    summarizerModel: createStubModel('gpt-5.4-nano'),
    tools: [],
  })

  ;(
    service as never as {
      agent: { invoke(payload: unknown): Promise<unknown> }
    }
  ).agent = {
    invoke: async (payload) => {
      agentInvocations.push(payload)
      return {
        messages: [{ content: 'vision reply' }],
      }
    },
  }

  assert.equal(service.supportsImageInput(), true)

  const reply = await service.invokeLive('private:1', {
    text: 'Describe this image',
    imageUrl: 'https://images.test/cat.png',
  })

  assert.equal(reply, 'vision reply')

  const payload = agentInvocations[0] as {
    messages: Array<{ role: string; content: unknown }>
  }
  const lastMessage = payload.messages.at(-1)

  assert.deepEqual(lastMessage, {
    role: 'user',
    content: [
      {
        type: 'text',
        text: 'Describe this image',
      },
      {
        type: 'image_url',
        image_url: {
          url: 'https://images.test/cat.png',
        },
      },
    ],
  })

  const history = await service.getHistory('private:1')
  assert.deepEqual(
    history
      .map((message) => ({
        role: message.role,
        content: message.content,
      }))
      .sort((left, right) =>
        `${left.role}:${left.content}`.localeCompare(
          `${right.role}:${right.content}`
        )
      ),
    [
      {
        role: 'assistant',
        content: 'vision reply',
      },
      {
        role: 'user',
        content: '[image attached]\nCaption: Describe this image',
      },
    ].sort((left, right) =>
      `${left.role}:${left.content}`.localeCompare(
        `${right.role}:${right.content}`
      )
    )
  )
})

test('non-vision role wiring falls back to text-shadow input for live and persisted memory', async () => {
  const redis = new InMemoryRedis()
  const agentInvocations: unknown[] = []
  const service = new AgentService({
    redis: redis.asRedis(),
    agentModel: createStubModel('gpt-5.4-nano'),
    summarizerModel: createStubModel('gpt-5.4-nano'),
    tools: [],
  })

  ;(
    service as never as {
      agent: { invoke(payload: unknown): Promise<unknown> }
    }
  ).agent = {
    invoke: async (payload) => {
      agentInvocations.push(payload)
      return {
        messages: [{ content: 'text-only reply' }],
      }
    },
  }

  assert.equal(service.supportsImageInput(), false)
  assert.equal(
    buildPersistedTextShadow({ imageUrl: 'https://images.test/only.png' }),
    '[image attached]'
  )

  await service.invokeLive('private:2', {
    text: 'What is in this image?',
    imageUrl: 'https://images.test/only.png',
  })
  await service.persistUserMessage('private:2', {
    imageUrl: 'https://images.test/follow-up.png',
  })

  const payload = agentInvocations[0] as {
    messages: Array<{ role: string; content: unknown }>
  }

  assert.deepEqual(payload.messages.at(-1), {
    role: 'user',
    content: '[image attached]\nCaption: What is in this image?',
  })

  const history = await service.getHistory('private:2')
  assert.deepEqual(
    history.map((message) => message.content).sort(),
    [
      '[image attached]',
      '[image attached]\nCaption: What is in this image?',
      'text-only reply',
    ].sort()
  )
})

test('clearHistory deletes summaries and only clears the targeted chat scope', async () => {
  const redis = new InMemoryRedis()
  const service = new AgentService({
    redis: redis.asRedis(),
    agentModel: createStubModel('gpt-5.4-mini'),
    summarizerModel: createStubModel('gpt-5.4-nano'),
    tools: [],
  })
  const summaryStore = new SummaryStore(redis.asRedis())

  await service.persistUserMessage('group:1', { text: 'alpha' })
  await service.persistUserMessage('group:2', { text: 'beta' })
  await summaryStore.saveSummary({
    level: 'daily',
    chatId: 'group:1',
    startTime: 1,
    endTime: 2,
    summary: 'group one daily',
    messageCount: 1,
    keyTopics: ['alpha'],
    createdAt: 3,
  })
  await summaryStore.saveSummary({
    level: 'monthly',
    chatId: 'group:1',
    startTime: 1,
    endTime: 4,
    summary: 'group one monthly',
    messageCount: 1,
    keyTopics: ['alpha'],
    createdAt: 5,
  })
  await summaryStore.saveSummary({
    level: 'daily',
    chatId: 'group:2',
    startTime: 1,
    endTime: 2,
    summary: 'group two daily',
    messageCount: 1,
    keyTopics: ['beta'],
    createdAt: 3,
  })

  await service.clearHistory('group:1')

  assert.deepEqual(await service.getHistory('group:1'), [])
  assert.equal((await summaryStore.getSummaries('group:1', 'daily')).length, 0)
  assert.equal(
    (await summaryStore.getSummaries('group:1', 'monthly')).length,
    0
  )

  const preservedHistory = await service.getHistory('group:2')
  assert.equal(preservedHistory.length, 1)
  assert.equal(preservedHistory[0]?.content, 'beta')
  assert.equal((await summaryStore.getSummaries('group:2', 'daily')).length, 1)
})
