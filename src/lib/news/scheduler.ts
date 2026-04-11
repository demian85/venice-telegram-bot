import { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type { NewsConfig } from './types'
import { FeedReader } from './feed-reader'
import { NewsStore } from './news-store'
import { RelevanceDetector } from './relevance-detector'
import type { ChatOpenAI } from '@langchain/openai'

export interface NewsSchedulerConfig {
  redis: Redis
  model: ChatOpenAI
  newsConfig: NewsConfig
  onRelevantArticle?: (article: {
    title: string
    url: string
    description?: string
    relevanceScore: number
  }) => Promise<void>
}

export class NewsScheduler {
  private readonly feedReader: FeedReader
  private readonly newsStore: NewsStore
  private readonly relevanceDetector: RelevanceDetector
  private readonly config: NewsConfig
  private readonly queue: Queue
  private readonly worker: Worker

  constructor(config: NewsSchedulerConfig) {
    this.feedReader = new FeedReader()
    this.newsStore = new NewsStore(config.redis)
    this.relevanceDetector = new RelevanceDetector(config.model)
    this.config = config.newsConfig

    this.queue = new Queue('news-polling', {
      connection: config.redis,
    })

    this.worker = new Worker(
      'news-polling',
      async () => {
        await this.pollFeeds()
        await this.scoreArticles()
        if (config.onRelevantArticle) {
          await this.forwardRelevantArticles(config.onRelevantArticle)
        }
      },
      { connection: config.redis }
    )
  }

  async start(): Promise<void> {
    await this.queue.add(
      'poll-news',
      {},
      { repeat: { every: this.config.pollIntervalMinutes * 60 * 1000 } }
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

  private async forwardRelevantArticles(
    callback: (article: {
      title: string
      url: string
      description?: string
      relevanceScore: number
    }) => Promise<void>
  ): Promise<void> {
    const items = await this.newsStore.getUnforwardedRelevantItems(
      this.config.relevanceThreshold
    )

    for (const item of items) {
      await callback({
        title: item.title,
        url: item.url,
        description: item.description,
        relevanceScore: item.relevanceScore || 0,
      })
      await this.newsStore.markForwarded(item.id)
    }
  }
}
