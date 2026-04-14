import { test, expect, describe } from 'vitest'
import { ConversationStore } from '../src/lib/redis/conversation-store.js'
import { InMemoryRedis } from './test-helpers.js'

describe('ConversationStore', () => {
  function createStore() {
    const redis = new InMemoryRedis()
    return { store: new ConversationStore(redis.asRedis()), redis }
  }

  test('adds and retrieves messages in order', async () => {
    const { store } = createStore()

    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Hello',
      timestamp: 1000,
    })
    await store.addMessage('chat-1', {
      role: 'assistant',
      content: 'Hi there',
      timestamp: 2000,
    })
    await store.addMessage('chat-1', {
      role: 'user',
      content: 'How are you?',
      timestamp: 3000,
    })

    const history = await store.getHistory('chat-1')

    expect(history).toHaveLength(3)
    expect(history[0]).toEqual({
      role: 'user',
      content: 'Hello',
      timestamp: 1000,
    })
    expect(history[1]).toEqual({
      role: 'assistant',
      content: 'Hi there',
      timestamp: 2000,
    })
    expect(history[2]).toEqual({
      role: 'user',
      content: 'How are you?',
      timestamp: 3000,
    })
  })

  test('returns messages sorted by timestamp', async () => {
    const { store } = createStore()

    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Third',
      timestamp: 3000,
    })
    await store.addMessage('chat-1', {
      role: 'user',
      content: 'First',
      timestamp: 1000,
    })
    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Second',
      timestamp: 2000,
    })

    const history = await store.getHistory('chat-1')
    const contents = history.map((m) => m.content)

    expect(contents).toEqual(['First', 'Second', 'Third'])
  })

  test('limits history when limit is specified', async () => {
    const { store } = createStore()

    for (let i = 1; i <= 10; i++) {
      await store.addMessage('chat-1', {
        role: 'user',
        content: `Message ${i}`,
        timestamp: i * 1000,
      })
    }

    const history = await store.getHistory('chat-1', 3)
    const contents = history.map((m) => m.content)

    expect(history).toHaveLength(3)
    expect(contents).toEqual(['Message 8', 'Message 9', 'Message 10'])
  })

  test('returns all messages when limit is not specified', async () => {
    const { store } = createStore()

    for (let i = 1; i <= 5; i++) {
      await store.addMessage('chat-1', {
        role: 'user',
        content: `Message ${i}`,
        timestamp: i * 1000,
      })
    }

    const history = await store.getHistory('chat-1')

    expect(history).toHaveLength(5)
  })

  test('returns empty array for unknown chat', async () => {
    const { store } = createStore()

    const history = await store.getHistory('unknown-chat')

    expect(history).toEqual([])
  })

  test('isolates chats by ID', async () => {
    const { store } = createStore()

    await store.addMessage('chat-a', {
      role: 'user',
      content: 'Message in A',
      timestamp: 1000,
    })
    await store.addMessage('chat-b', {
      role: 'user',
      content: 'Message in B',
      timestamp: 1000,
    })

    const historyA = await store.getHistory('chat-a')
    const historyB = await store.getHistory('chat-b')

    expect(historyA).toHaveLength(1)
    expect(historyA[0]?.content).toBe('Message in A')
    expect(historyB).toHaveLength(1)
    expect(historyB[0]?.content).toBe('Message in B')
  })

  test('clears history for specific chat', async () => {
    const { store } = createStore()

    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Message 1',
      timestamp: 1000,
    })
    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Message 2',
      timestamp: 2000,
    })

    await store.clearHistory('chat-1')

    const history = await store.getHistory('chat-1')
    expect(history).toEqual([])
  })

  test('clearHistory only affects target chat', async () => {
    const { store } = createStore()

    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Message in 1',
      timestamp: 1000,
    })
    await store.addMessage('chat-2', {
      role: 'user',
      content: 'Message in 2',
      timestamp: 1000,
    })

    await store.clearHistory('chat-1')

    const history1 = await store.getHistory('chat-1')
    const history2 = await store.getHistory('chat-2')

    expect(history1).toEqual([])
    expect(history2).toHaveLength(1)
    expect(history2[0]?.content).toBe('Message in 2')
  })

  test('getHistoryCount returns correct count', async () => {
    const { store } = createStore()

    expect(await store.getHistoryCount('chat-1')).toBe(0)

    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Message 1',
      timestamp: 1000,
    })
    expect(await store.getHistoryCount('chat-1')).toBe(1)

    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Message 2',
      timestamp: 2000,
    })
    expect(await store.getHistoryCount('chat-1')).toBe(2)
  })

  test('getHistoryCount returns 0 for unknown chat', async () => {
    const { store } = createStore()

    const count = await store.getHistoryCount('unknown-chat')

    expect(count).toBe(0)
  })

  test('ignores invalid JSON messages', async () => {
    const { store, redis } = createStore()

    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Valid message',
      timestamp: 1000,
    })

    // Manually add invalid JSON
    await redis.lpush('conversation:chat-1', 'not valid json')

    const history = await store.getHistory('chat-1')

    expect(history).toHaveLength(1)
    expect(history[0]?.content).toBe('Valid message')
  })

  test('handles all valid roles', async () => {
    const { store } = createStore()

    await store.addMessage('chat-1', {
      role: 'system',
      content: 'System prompt',
      timestamp: 1000,
    })
    await store.addMessage('chat-1', {
      role: 'user',
      content: 'User message',
      timestamp: 2000,
    })
    await store.addMessage('chat-1', {
      role: 'assistant',
      content: 'Assistant response',
      timestamp: 3000,
    })

    const history = await store.getHistory('chat-1')

    expect(history.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
  })

  test('limit of 0 returns all messages', async () => {
    const { store } = createStore()

    await store.addMessage('chat-1', {
      role: 'user',
      content: 'Message',
      timestamp: 1000,
    })

    const history = await store.getHistory('chat-1', 0)

    expect(history).toHaveLength(1)
  })
})
