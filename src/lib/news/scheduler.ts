import { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type { NewsConfig } from './types.js'
import { FeedReader } from './feed-reader.js'
import { NewsStore } from './news-store.js'
import { RelevanceDetector } from './relevance-detector.js'
import { ChatSubscriptionStore } from './chat-subscription-store.js'
import { NewsDeliveryStore } from './news-delivery-store.js'
import type { ChatOpenAI } from '@langchain/openai'
import logger from '@lib/logger.js'

const deliveryIntervalMs = 60 * 1000
const startupJobRegistrations = [
  { name: 'poll-news', jobId: 'poll-news-startup' },
  { name: 'deliver-news', jobId: 'deliver-news-startup' },
] as const

interface RelevantArticle {
  articleId: string
  title: string
  url: string
  description?: string
  relevanceScore: number
}

interface DeliverableItemDecision {
  nextItem: {
    id: string
    title: string
    url: string
    description?: string
    relevanceScore?: number
    fetchedAt: Date
  } | null
  skipReason?:
    | 'no_relevant_items'
    | 'already_delivered'
    | 'pre_deliver_after_gate'
  deliverAfterFilteredCount: number
  alreadyDeliveredCount: number
  candidateCount: number
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
      dependencies.relevanceDetector ??
      new RelevanceDetector(config.model, {
        topics: config.newsConfig.topics,
        relevanceThreshold: config.newsConfig.relevanceThreshold,
      })
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
          // NOTE: These lifecycle events are debug-only; set LOG_LEVEL=debug to see them.
          logger.debug(
            {
              event: 'news.job.start',
              jobName: job.name,
              jobId: job.id,
              repeatEveryMs: job.opts.repeat?.every,
            },
            'News job started'
          )

          try {
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

            logger.debug(
              {
                event: 'news.job.complete',
                jobName: job.name,
                jobId: job.id,
                repeatEveryMs: job.opts.repeat?.every,
              },
              'News job completed'
            )
          } catch (error) {
            logger.error(
              {
                event: 'news.job.fail',
                jobName: job.name,
                jobId: job.id,
                repeatEveryMs: job.opts.repeat?.every,
                err: error,
              },
              'News job failed'
            )
            throw error
          }
        },
        {
          connection: config.redis.duplicate({
            maxRetriesPerRequest: null,
          }),
        }
      )
  }

  async start(): Promise<void> {
    const pollIntervalMs = this.config.pollIntervalMinutes * 60 * 1000
    const repeatJobRegistrations = [
      {
        name: 'poll-news',
        jobId: 'poll-news-repeat',
        everyMs: pollIntervalMs,
      },
      {
        name: 'deliver-news',
        jobId: 'deliver-news-repeat',
        everyMs: deliveryIntervalMs,
      },
    ] as const

    for (const job of startupJobRegistrations) {
      await this.queue.add(job.name, {}, { jobId: job.jobId })
      logger.debug(
        {
          event: 'news.job.enqueue',
          jobName: job.name,
          jobId: job.jobId,
          schedule: 'startup',
        },
        'News job enqueued'
      )
    }

    for (const job of repeatJobRegistrations) {
      await this.queue.add(
        job.name,
        {},
        {
          jobId: job.jobId,
          repeat: { every: job.everyMs },
        }
      )
      logger.debug(
        {
          event: 'news.job.enqueue',
          jobName: job.name,
          jobId: job.jobId,
          schedule: 'repeat',
          repeatEveryMs: job.everyMs,
        },
        'News job enqueued'
      )
    }

    // NOTE: This startup event is debug-only; set LOG_LEVEL=debug to see it.
    logger.debug(
      {
        event: 'news.scheduler.start',
        pollIntervalMinutes: this.config.pollIntervalMinutes,
        deliveryIntervalMs,
        feedCount: this.config.feeds.length,
        relevanceThreshold: this.config.relevanceThreshold,
        repeatJobRegistrations,
      },
      'News scheduler jobs registered'
    )
  }

  async stop(): Promise<void> {
    await this.queue.close()
    await this.worker.close()
  }

  private async pollFeeds(): Promise<void> {
    const items = await this.feedReader.fetchAllFeeds(this.config.feeds)
    const limited = items.slice(0, this.config.maxArticlesPerPoll)
    let storedCount = 0

    for (const item of limited) {
      const existing = await this.newsStore.getItem(item.id)
      if (!existing) {
        await this.newsStore.storeItem(item)
        storedCount++
        continue
      }

      logger.debug(
        {
          event: 'news.item.duplicate_skip',
          itemId: item.id,
          itemUrl: item.url,
        },
        'Skipped duplicate news item before store write'
      )
    }

    if (storedCount > 0) {
      logger.info(
        {
          event: 'news.feed.poll.complete',
          feedCount: this.config.feeds.length,
          itemsPolled: items.length,
          itemsStored: storedCount,
        },
        `Polled ${this.config.feeds.length} feeds, stored ${storedCount} new articles`
      )
    }
  }

  private async scoreArticles(): Promise<void> {
    const unscored = await this.newsStore.getUnscoredItems(20)

    if (unscored.length === 0) {
      return
    }

    logger.info(
      {
        event: 'news.score.start',
        articleCount: unscored.length,
      },
      `Scoring ${unscored.length} articles for relevance`
    )

    const scores = await this.relevanceDetector.batchDetectRelevance(unscored)
    let relevantCount = 0

    for (const [id, { score, isRelevant }] of scores) {
      await this.newsStore.updateRelevance(id, score, isRelevant)
      if (isRelevant) {
        relevantCount++
      }
    }

    logger.info(
      {
        event: 'news.score.complete',
        articleCount: unscored.length,
        relevantCount,
      },
      `Scored ${unscored.length} articles, ${relevantCount} are relevant`
    )
  }

  private async deliverRelevantArticles(
    callback: DeliveryCallback
  ): Promise<void> {
    const now = new Date()
    const [subscriptions, relevantItems] = await Promise.all([
      this.chatSubscriptionStore.listEnabledSubscriptions(),
      this.newsStore.getRelevantItems(this.config.relevanceThreshold),
    ])

    logger.debug(
      {
        event: 'news.delivery.tick',
        subscribedChatCount: subscriptions.length,
        relevantItemCount: relevantItems.length,
        deliveryThreshold: this.config.relevanceThreshold,
      },
      'Evaluating subscribed chats for news delivery'
    )

    for (const subscription of subscriptions) {
      const eligibleAt = this.getEligibleDeliveryTime(subscription)

      if (eligibleAt.getTime() > now.getTime()) {
        logger.debug(
          {
            event: 'news.delivery.chat.skip',
            chatId: subscription.chatId,
            skipReason: 'not_due',
            now,
            eligibleAt,
            intervalSeconds: subscription.intervalSeconds,
            deliverAfter: subscription.deliverAfter,
            lastSentAt: subscription.lastSentAt,
            relevantItemCount: relevantItems.length,
          },
          'Subscribed chat is not yet eligible for delivery'
        )
        continue
      }

      const decision = await this.findNextDeliverableItem(
        subscription.chatId,
        subscription.deliverAfter,
        relevantItems
      )

      if (!decision.nextItem) {
        logger.debug(
          {
            event: 'news.delivery.chat.skip',
            chatId: subscription.chatId,
            skipReason: decision.skipReason,
            eligibleAt,
            intervalSeconds: subscription.intervalSeconds,
            deliverAfter: subscription.deliverAfter,
            lastSentAt: subscription.lastSentAt,
            relevantItemCount: relevantItems.length,
            candidateCount: decision.candidateCount,
            deliverAfterFilteredCount: decision.deliverAfterFilteredCount,
            alreadyDeliveredCount: decision.alreadyDeliveredCount,
          },
          'Subscribed chat has no pending relevant article to deliver'
        )
        continue
      }

      const nextItem = decision.nextItem

      logger.debug(
        {
          event: 'news.delivery.chat.eligible',
          chatId: subscription.chatId,
          eligibleAt,
          intervalSeconds: subscription.intervalSeconds,
          deliverAfter: subscription.deliverAfter,
          lastSentAt: subscription.lastSentAt,
          pendingArticleId: nextItem.id,
          pendingArticleTitle: nextItem.title,
          pendingArticleFetchedAt: nextItem.fetchedAt,
          candidateCount: decision.candidateCount,
          deliverAfterFilteredCount: decision.deliverAfterFilteredCount,
          alreadyDeliveredCount: decision.alreadyDeliveredCount,
        },
        'Subscribed chat is eligible and has a pending relevant article'
      )

      await this.newsDeliveryStore.markDelivered(
        subscription.chatId,
        nextItem.id,
        now
      )

      logger.debug(
        {
          event: 'news.telegram.send.start',
          chatId: subscription.chatId,
          articleId: nextItem.id,
          articleTitle: nextItem.title,
          articleUrl: nextItem.url,
          score: nextItem.relevanceScore || 0,
          deliveryState: 'marked_delivered',
          markedDeliveredAt: now,
        },
        'Marked relevant article delivered before Telegram callback'
      )

      try {
        await callback({
          chatId: subscription.chatId,
          article: {
            articleId: nextItem.id,
            title: nextItem.title,
            url: nextItem.url,
            description: nextItem.description,
            relevanceScore: nextItem.relevanceScore || 0,
          },
        })
      } catch (error) {
        logger.error(
          {
            event: 'news.telegram.send.error',
            chatId: subscription.chatId,
            articleId: nextItem.id,
            articleTitle: nextItem.title,
            articleUrl: nextItem.url,
            score: nextItem.relevanceScore || 0,
            rollbackAction: 'unmarkDelivered',
            err: error,
          },
          'Telegram delivery callback failed'
        )

        await this.newsDeliveryStore.unmarkDelivered(
          subscription.chatId,
          nextItem.id
        )

        logger.error(
          {
            event: 'news.delivery.rollback',
            chatId: subscription.chatId,
            articleId: nextItem.id,
            articleTitle: nextItem.title,
            articleUrl: nextItem.url,
            score: nextItem.relevanceScore || 0,
            rollbackAction: 'unmarkDelivered',
          },
          'Rolled back delivered article after Telegram failure'
        )

        throw error
      }

      await this.chatSubscriptionStore.markSent(subscription.chatId, now)

      logger.info(
        {
          event: 'news.delivery.success',
          chatId: subscription.chatId,
          articleId: nextItem.id,
          articleTitle: nextItem.title,
          relevanceScore: nextItem.relevanceScore || 0,
        },
        `Delivered article "${nextItem.title.slice(0, 50)}..." to chat ${subscription.chatId}`
      )

      logger.debug(
        {
          event: 'news.telegram.send.success',
          chatId: subscription.chatId,
          articleId: nextItem.id,
          articleTitle: nextItem.title,
          articleUrl: nextItem.url,
          score: nextItem.relevanceScore || 0,
          deliveryState: 'marked_sent',
          sentAt: now,
        },
        'Recorded successful relevant article delivery'
      )
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
  ): Promise<DeliverableItemDecision> {
    let candidateCount = 0
    let deliverAfterFilteredCount = 0
    let alreadyDeliveredCount = 0

    for (const item of relevantItems) {
      if (item.fetchedAt.getTime() < deliverAfter.getTime()) {
        deliverAfterFilteredCount += 1
        continue
      }

      candidateCount += 1

      const alreadyDelivered = await this.newsDeliveryStore.hasDelivered(
        chatId,
        item.id
      )

      if (!alreadyDelivered) {
        return {
          nextItem: item,
          candidateCount,
          deliverAfterFilteredCount,
          alreadyDeliveredCount,
        }
      }

      alreadyDeliveredCount += 1
    }

    const skipReason =
      relevantItems.length === 0
        ? 'no_relevant_items'
        : candidateCount === 0
          ? 'pre_deliver_after_gate'
          : alreadyDeliveredCount > 0
            ? 'already_delivered'
            : 'no_relevant_items'

    return {
      nextItem: null,
      skipReason,
      candidateCount,
      deliverAfterFilteredCount,
      alreadyDeliveredCount,
    }
  }
}
