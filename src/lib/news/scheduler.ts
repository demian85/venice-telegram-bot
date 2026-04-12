import { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type { NewsConfig } from './types'
import { FeedReader } from './feed-reader'
import { NewsStore } from './news-store'
import { RelevanceDetector } from './relevance-detector'
import { ChatSubscriptionStore } from './chat-subscription-store'
import { NewsDeliveryStore } from './news-delivery-store'
import type { ChatOpenAI } from '@langchain/openai'

const deliveryIntervalMs = 60 * 1000

interface RelevantArticle {
  title: string
  url: string
  description?: string
  relevanceScore: number
}

type DeliveryCallback = (delivery: {
  chatId: string
  article: RelevantArticle
}) => Promise<void>

interface QueueLike {
  add(
    name: string,
    data: Record<string, never>,
    options?: object
  ): Promise<unknown>
  close(): Promise<unknown>
}

interface WorkerLike {
  close(): Promise<unknown>
}

export interface NewsSchedulerConfig {
  redis: Redis
  model: ChatOpenAI
  newsConfig: NewsConfig
  onDeliverArticle?: DeliveryCallback
}

export interface NewsSchedulerDependencies {
  feedReader?: FeedReader
  newsStore?: NewsStore
  relevanceDetector?: RelevanceDetector
  chatSubscriptionStore?: ChatSubscriptionStore
  newsDeliveryStore?: NewsDeliveryStore
  queue?: QueueLike
  worker?: WorkerLike
}

export class NewsScheduler {
  private readonly feedReader: FeedReader
  private readonly newsStore: NewsStore
  private readonly relevanceDetector: RelevanceDetector
  private readonly chatSubscriptionStore: ChatSubscriptionStore
  private readonly newsDeliveryStore: NewsDeliveryStore
  private readonly config: NewsConfig
  private readonly queue: QueueLike
  private readonly worker: WorkerLike

  constructor(
    config: NewsSchedulerConfig,
    dependencies: NewsSchedulerDependencies = {}
  ) {
    this.feedReader = dependencies.feedReader ?? new FeedReader()
    this.newsStore = dependencies.newsStore ?? new NewsStore(config.redis)
    this.relevanceDetector =
      dependencies.relevanceDetector ?? new RelevanceDetector(config.model)
    this.chatSubscriptionStore =
      dependencies.chatSubscriptionStore ??
      new ChatSubscriptionStore(config.redis)
    this.newsDeliveryStore =
      dependencies.newsDeliveryStore ?? new NewsDeliveryStore(config.redis)
    this.config = config.newsConfig

    this.queue =
      dependencies.queue ??
      new Queue('news-polling', {
        connection: config.redis,
      })

    this.worker =
      dependencies.worker ??
      new Worker(
        'news-polling',
        async (job) => {
          switch (job.name) {
            case 'poll-news':
              await this.pollFeeds()
              await this.scoreArticles()
              break
            case 'deliver-news':
              if (config.onDeliverArticle) {
                await this.deliverRelevantArticles(config.onDeliverArticle)
              }
              break
          }
        },
        { connection: config.redis }
      )
  }

  async start(): Promise<void> {
    await this.queue.add('poll-news', {}, { jobId: 'poll-news:startup' })
    await this.queue.add('deliver-news', {}, { jobId: 'deliver-news:startup' })
    await this.queue.add(
      'poll-news',
      {},
      {
        jobId: 'poll-news:repeat',
        repeat: { every: this.config.pollIntervalMinutes * 60 * 1000 },
      }
    )
    await this.queue.add(
      'deliver-news',
      {},
      {
        jobId: 'deliver-news:repeat',
        repeat: { every: deliveryIntervalMs },
      }
    )
  }

  async stop(): Promise<void> {
    await this.queue.close()
    await this.worker.close()
  }

  private async pollFeeds(): Promise<void> {
    const items = await this.feedReader.fetchAllFeeds(this.config.feeds)
    const limited = items.slice(0, this.config.maxArticlesPerPoll)

    for (const item of limited) {
      const existing = await this.newsStore.getItem(item.id)
      if (!existing) {
        await this.newsStore.storeItem(item)
      }
    }
  }

  private async scoreArticles(): Promise<void> {
    const unscored = await this.newsStore.getUnscoredItems(20)
    const scores = await this.relevanceDetector.batchDetectRelevance(unscored)

    for (const [id, { score, isRelevant }] of scores) {
      await this.newsStore.updateRelevance(id, score, isRelevant)
    }
  }

  private async deliverRelevantArticles(
    callback: DeliveryCallback
  ): Promise<void> {
    const now = new Date()
    const [subscriptions, relevantItems] = await Promise.all([
      this.chatSubscriptionStore.listEnabledSubscriptions(),
      this.newsStore.getRelevantItems(this.config.relevanceThreshold),
    ])

    for (const subscription of subscriptions) {
      const eligibleAt = this.getEligibleDeliveryTime(subscription)

      if (eligibleAt.getTime() > now.getTime()) {
        continue
      }

      const nextItem = await this.findNextDeliverableItem(
        subscription.chatId,
        subscription.deliverAfter,
        relevantItems
      )

      if (!nextItem) {
        continue
      }

      await this.newsDeliveryStore.markDelivered(
        subscription.chatId,
        nextItem.id,
        now
      )

      try {
        await callback({
          chatId: subscription.chatId,
          article: {
            title: nextItem.title,
            url: nextItem.url,
            description: nextItem.description,
            relevanceScore: nextItem.relevanceScore || 0,
          },
        })
      } catch (error) {
        await this.newsDeliveryStore.unmarkDelivered(
          subscription.chatId,
          nextItem.id
        )
        throw error
      }

      await this.chatSubscriptionStore.markSent(subscription.chatId, now)
    }
  }

  private getEligibleDeliveryTime(subscription: {
    intervalSeconds: number
    deliverAfter: Date
    lastSentAt?: Date
  }): Date {
    if (!subscription.lastSentAt) {
      return subscription.deliverAfter
    }

    const cooldownEndsAt = new Date(
      subscription.lastSentAt.getTime() + subscription.intervalSeconds * 1000
    )

    return cooldownEndsAt.getTime() > subscription.deliverAfter.getTime()
      ? cooldownEndsAt
      : subscription.deliverAfter
  }

  private async findNextDeliverableItem(
    chatId: string,
    deliverAfter: Date,
    relevantItems: Array<{
      id: string
      title: string
      url: string
      description?: string
      relevanceScore?: number
      fetchedAt: Date
    }>
  ) {
    for (const item of relevantItems) {
      if (item.fetchedAt.getTime() < deliverAfter.getTime()) {
        continue
      }

      const alreadyDelivered = await this.newsDeliveryStore.hasDelivered(
        chatId,
        item.id
      )

      if (!alreadyDelivered) {
        return item
      }
    }

    return null
  }
}
