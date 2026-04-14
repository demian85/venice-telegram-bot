import type { Redis } from 'ioredis'
import type { NewsItem } from './types.js'
import { FeedReader } from './feed-reader.js'
import { NewsStore } from './news-store.js'
import logger from '@lib/logger.js'

export interface RecentNewsItem {
  id: string
  title: string
  url: string
  source: string
  publishedAt: Date
  fetchedAt: Date
  relevanceScore?: number
  description?: string
}

export interface NewsQueryServiceConfig {
  redis: Redis
  relevanceThreshold: number
  feeds?: string[]
}

export class NewsQueryService {
  private readonly redis: Redis
  private readonly relevanceThreshold: number
  private readonly keyPrefix = 'news:'
  private readonly feedReader: FeedReader
  private readonly newsStore: NewsStore
  private readonly feeds: string[]

  constructor(config: NewsQueryServiceConfig) {
    this.redis = config.redis
    this.relevanceThreshold = config.relevanceThreshold
    this.feeds = config.feeds || []
    this.feedReader = new FeedReader()
    this.newsStore = new NewsStore(config.redis)
  }

  async getRecentNews(limit: number): Promise<RecentNewsItem[]> {
    const clampedLimit = Math.max(1, Math.min(10, limit))
    const totalCount = await this.redis.zcard(`${this.keyPrefix}items`)

    const scoredItems: RecentNewsItem[] = []
    const unscoredItems: RecentNewsItem[] = []

    let offset = 0
    const batchSize = 20
    const maxOffset = 100

    while (
      scoredItems.length < clampedLimit &&
      offset < totalCount &&
      offset < maxOffset
    ) {
      const ids = await this.redis.zrevrange(
        `${this.keyPrefix}items`,
        offset,
        offset + batchSize - 1
      )

      if (ids.length === 0) break

      for (const id of ids) {
        const item = await this.getNewsItem(id)
        if (!item) continue

        if (
          item.relevanceScore !== undefined &&
          item.relevanceScore >= this.relevanceThreshold
        ) {
          scoredItems.push(item)
          if (scoredItems.length >= clampedLimit) break
        } else if (item.relevanceScore === undefined) {
          unscoredItems.push(item)
        }
      }

      offset += batchSize
    }

    return scoredItems.length > 0
      ? scoredItems.slice(0, clampedLimit)
      : unscoredItems.slice(0, clampedLimit)
  }

  async fetchAndGetRecentNews(limit: number): Promise<RecentNewsItem[]> {
    if (this.feeds.length === 0) {
      logger.warn(
        { event: 'news.fetch_no_feeds' },
        'No feeds configured for on-demand fetch, returning cached news only'
      )
      return this.getRecentNews(limit)
    }

    try {
      logger.info(
        { event: 'news.fetch_ondemand_start', feedCount: this.feeds.length },
        `Fetching fresh news from ${this.feeds.length} feeds on user request`
      )

      const items = await this.feedReader.fetchAllFeeds(this.feeds)
      let newItemsCount = 0

      for (const item of items.slice(0, 20)) {
        const wasStored = await this.newsStore.storeItem(item)
        if (wasStored) {
          newItemsCount++
        }
      }

      logger.info(
        {
          event: 'news.fetch_ondemand_complete',
          feedCount: this.feeds.length,
          fetchedItems: items.length,
          newItemsStored: newItemsCount,
        },
        `On-demand fetch complete: ${newItemsCount} new articles stored`
      )

      return this.getRecentNews(limit)
    } catch (error) {
      logger.error(
        {
          event: 'news.fetch_ondemand_error',
          error: error instanceof Error ? error.message : String(error),
          err: error,
        },
        'Failed to fetch fresh news on demand, returning cached'
      )
      return this.getRecentNews(limit)
    }
  }

  async getRecentNewsRaw(limit: number): Promise<RecentNewsItem[]> {
    const clampedLimit = Math.max(1, Math.min(10, limit))
    const ids = await this.redis.zrevrange(
      `${this.keyPrefix}items`,
      0,
      clampedLimit - 1
    )

    const items: RecentNewsItem[] = []
    for (const id of ids) {
      const item = await this.getNewsItem(id)
      if (item) {
        items.push(item)
      }
    }

    return items
  }

  private async getNewsItem(id: string): Promise<RecentNewsItem | null> {
    const key = `${this.keyPrefix}item:${id}`
    const data = await this.redis.get(key)
    if (!data) return null

    const item = JSON.parse(data) as Omit<
      NewsItem,
      'publishedAt' | 'fetchedAt' | 'legacyBroadcastedAt'
    > & {
      publishedAt: string
      fetchedAt: string
      legacyBroadcastedAt?: string
    }

    return {
      id: item.id,
      title: item.title,
      url: item.url,
      source: item.source,
      publishedAt: new Date(item.publishedAt),
      fetchedAt: new Date(item.fetchedAt),
      relevanceScore: item.relevanceScore,
      description: item.description,
    }
  }
}
