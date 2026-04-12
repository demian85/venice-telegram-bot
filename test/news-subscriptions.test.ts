import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ChatSubscriptionStore,
  NewsDeliveryStore,
  NewsScheduler,
  NewsStore,
  defaultNewsConfig,
  defaultNewsIntervalSeconds,
  minNewsIntervalSeconds,
  type NewsItem,
} from '../src/lib/news'
import {
  InMemoryRedis,
  createNoopQueue,
  createNoopWorker,
} from './test-helpers'

function createNewsItem(input: {
  id: string
  title: string
  fetchedAt: string
  score?: number
}): NewsItem {
  return {
    id: input.id,
    source: 'test-source',
    feedUrl: 'https://feeds.test/rss.xml',
    title: input.title,
    description: `${input.title} description`,
    url: `https://news.test/${input.id}`,
    publishedAt: new Date(input.fetchedAt),
    fetchedAt: new Date(input.fetchedAt),
    relevanceScore: input.score ?? 90,
    isRelevant: true,
  }
}

async function overwriteSubscription(
  redis: InMemoryRedis,
  subscription: Awaited<ReturnType<ChatSubscriptionStore['getSubscription']>>
) {
  assert.ok(subscription)
  await redis.set(
    `news:chat-subscription:${subscription.chatId}`,
    JSON.stringify(subscription)
  )
}

test('subscription defaults are disabled, use the default interval, and reject invalid intervals', async () => {
  const redis = new InMemoryRedis()
  const store = new ChatSubscriptionStore(redis.asRedis())
  const now = new Date('2026-04-11T10:00:00.000Z')

  const subscription = await store.getOrCreateSubscription('chat-1', now)

  assert.equal(subscription.enabled, false)
  assert.equal(subscription.intervalSeconds, defaultNewsIntervalSeconds)
  assert.equal(subscription.deliverAfter.toISOString(), now.toISOString())

  await assert.rejects(
    () =>
      store.setIntervalSeconds(
        'chat-1',
        minNewsIntervalSeconds - 1,
        new Date('2026-04-11T10:05:00.000Z')
      ),
    /News interval must be an integer between/
  )
})

test('unsubscribe and resubscribe preserve the interval while resetting future delivery gating', async () => {
  const redis = new InMemoryRedis()
  const store = new ChatSubscriptionStore(redis.asRedis())

  await store.subscribe('chat-1', new Date('2026-04-11T10:00:00.000Z'))
  await store.setIntervalSeconds(
    'chat-1',
    900,
    new Date('2026-04-11T10:10:00.000Z')
  )
  const unsubscribed = await store.unsubscribe(
    'chat-1',
    new Date('2026-04-11T10:20:00.000Z')
  )
  const resubscribed = await store.subscribe(
    'chat-1',
    new Date('2026-04-11T10:30:00.000Z')
  )

  assert.equal(unsubscribed.enabled, false)
  assert.equal(resubscribed.enabled, true)
  assert.equal(resubscribed.intervalSeconds, 900)
  assert.equal(
    resubscribed.deliverAfter.toISOString(),
    '2026-04-11T10:30:00.000Z'
  )
  assert.equal(resubscribed.unsubscribedAt, undefined)
})

test('delivery stays isolated per chat and chooses the oldest eligible undelivered article first', async () => {
  const redis = new InMemoryRedis()
  const subscriptionStore = new ChatSubscriptionStore(redis.asRedis())
  const deliveryStore = new NewsDeliveryStore(redis.asRedis())
  const newsStore = new NewsStore(redis.asRedis())

  await subscriptionStore.subscribe(
    'chat-a',
    new Date('2026-04-11T09:00:00.000Z')
  )
  await subscriptionStore.subscribe(
    'chat-b',
    new Date('2026-04-11T09:00:00.000Z')
  )
  await newsStore.storeItem(
    createNewsItem({
      id: 'item-1',
      title: 'First relevant story',
      fetchedAt: '2026-04-11T09:01:00.000Z',
    })
  )
  await newsStore.storeItem(
    createNewsItem({
      id: 'item-2',
      title: 'Second relevant story',
      fetchedAt: '2026-04-11T09:02:00.000Z',
    })
  )

  const scheduler = new NewsScheduler(
    {
      redis: redis.asRedis(),
      model: {} as never,
      newsConfig: defaultNewsConfig,
    },
    {
      chatSubscriptionStore: subscriptionStore,
      newsDeliveryStore: deliveryStore,
      newsStore,
      queue: createNoopQueue(),
      worker: createNoopWorker(),
    }
  )

  const firstPass: Array<{ chatId: string; title: string }> = []
  await (
    scheduler as never as {
      deliverRelevantArticles(
        callback: (delivery: {
          chatId: string
          article: { title: string }
        }) => Promise<void>
      ): Promise<void>
    }
  ).deliverRelevantArticles(async (delivery) => {
    firstPass.push({ chatId: delivery.chatId, title: delivery.article.title })
  })

  assert.deepEqual(firstPass, [
    { chatId: 'chat-a', title: 'First relevant story' },
    { chatId: 'chat-b', title: 'First relevant story' },
  ])
  assert.equal(await deliveryStore.hasDelivered('chat-a', 'item-1'), true)
  assert.equal(await deliveryStore.hasDelivered('chat-b', 'item-1'), true)

  const expiredCooldownA = await subscriptionStore.getSubscription('chat-a')
  const expiredCooldownB = await subscriptionStore.getSubscription('chat-b')
  assert.ok(expiredCooldownA)
  assert.ok(expiredCooldownB)
  expiredCooldownA.lastSentAt = new Date('2026-04-11T08:00:00.000Z')
  expiredCooldownB.lastSentAt = new Date('2026-04-11T08:00:00.000Z')
  await overwriteSubscription(redis, expiredCooldownA)
  await overwriteSubscription(redis, expiredCooldownB)

  const secondPass: Array<{ chatId: string; title: string }> = []
  await (
    scheduler as never as {
      deliverRelevantArticles(
        callback: (delivery: {
          chatId: string
          article: { title: string }
        }) => Promise<void>
      ): Promise<void>
    }
  ).deliverRelevantArticles(async (delivery) => {
    secondPass.push({ chatId: delivery.chatId, title: delivery.article.title })
  })

  assert.deepEqual(secondPass, [
    { chatId: 'chat-a', title: 'Second relevant story' },
    { chatId: 'chat-b', title: 'Second relevant story' },
  ])
})

test('delivery respects cooldowns and skips items fetched before a resubscribe gate', async () => {
  const redis = new InMemoryRedis()
  const subscriptionStore = new ChatSubscriptionStore(redis.asRedis())
  const deliveryStore = new NewsDeliveryStore(redis.asRedis())
  const newsStore = new NewsStore(redis.asRedis())

  await newsStore.storeItem(
    createNewsItem({
      id: 'too-old',
      title: 'Older stored item',
      fetchedAt: '2026-04-11T09:59:00.000Z',
    })
  )
  await newsStore.storeItem(
    createNewsItem({
      id: 'eligible',
      title: 'Eligible new item',
      fetchedAt: '2026-04-11T10:01:00.000Z',
    })
  )

  await subscriptionStore.subscribe(
    'chat-1',
    new Date('2026-04-11T10:00:00.000Z')
  )
  const scheduler = new NewsScheduler(
    {
      redis: redis.asRedis(),
      model: {} as never,
      newsConfig: defaultNewsConfig,
    },
    {
      chatSubscriptionStore: subscriptionStore,
      newsDeliveryStore: deliveryStore,
      newsStore,
      queue: createNoopQueue(),
      worker: createNoopWorker(),
    }
  )

  const cooldownBlocked: string[] = []
  const subscription = await subscriptionStore.getSubscription('chat-1')
  assert.ok(subscription)
  subscription.lastSentAt = new Date()
  await overwriteSubscription(redis, subscription)

  await (
    scheduler as never as {
      deliverRelevantArticles(
        callback: (delivery: { article: { title: string } }) => Promise<void>
      ): Promise<void>
    }
  ).deliverRelevantArticles(async (delivery) => {
    cooldownBlocked.push(delivery.article.title)
  })

  assert.deepEqual(cooldownBlocked, [])

  subscription.lastSentAt = new Date('2026-04-11T08:00:00.000Z')
  await overwriteSubscription(redis, subscription)

  const deliveredTitles: string[] = []
  await (
    scheduler as never as {
      deliverRelevantArticles(
        callback: (delivery: { article: { title: string } }) => Promise<void>
      ): Promise<void>
    }
  ).deliverRelevantArticles(async (delivery) => {
    deliveredTitles.push(delivery.article.title)
  })

  assert.deepEqual(deliveredTitles, ['Eligible new item'])
  assert.equal(await deliveryStore.hasDelivered('chat-1', 'too-old'), false)
  assert.equal(await deliveryStore.hasDelivered('chat-1', 'eligible'), true)
})
