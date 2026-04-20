import type { Redis } from 'ioredis'
import logger from '@lib/logger.js'
import type { NewsItem } from './types.js'

export class NewsStore {
  private readonly redis: Redis
  private readonly keyPrefix = 'news:'

  constructor(redis: Redis) {
    this.redis = redis
  }

  async storeItem(item: NewsItem): Promise<boolean> {
    const key = `${this.keyPrefix}item:${item.id}`

    const existingItem = await this.redis.get(key)
    const existedBefore = existingItem !== null

    if (existedBefore) {
      logger.debug(
        {
          event: 'news.item.duplicate_skip',
          itemId: item.id,
          itemUrl: item.url,
        },
        'Skipped duplicate news item storage'
      )

      return false
    }

    await this.writeItem(key, item)

    logger.debug(
      {
        event: 'news.item.store',
        itemId: item.id,
        itemUrl: item.url,
      },
      'Stored news item'
    )

    return true
  }

  async checkItemExists(itemId: string): Promise<boolean> {
    const key = `${this.keyPrefix}item:${itemId}`
    const existing = await this.redis.get(key)
    return existing !== null
  }

  private async writeItem(key: string, item: NewsItem): Promise<void> {
    await this.redis.setex(key, 7 * 24 * 60 * 60, JSON.stringify(item))
    await this.redis.zadd(
      `${this.keyPrefix}items`,
      item.fetchedAt.getTime(),
      item.id
    )
  }

  async getItem(id: string): Promise<NewsItem | null> {
    const key = `${this.keyPrefix}item:${id}`
    const data = await this.redis.get(key)
    if (!data) return null
    return this.parseItem(data)
  }

  async getUnscoredItems(limit: number = 100): Promise<NewsItem[]> {
    const ids = await this.redis.zrevrange(
      `${this.keyPrefix}items`,
      0,
      limit - 1
    )
    const items: NewsItem[] = []
    for (const id of ids) {
      const item = await this.getItem(id)
      if (item && item.relevanceScore === undefined) {
        items.push(item)
      }
    }
    return items
  }

  async getUnforwardedRelevantItems(threshold: number): Promise<NewsItem[]> {
    const ids = await this.redis.zrevrange(`${this.keyPrefix}items`, 0, -1)
    const items: NewsItem[] = []
    for (const id of ids) {
      const item = await this.getItem(id)
      if (
        item &&
        !item.legacyBroadcastedAt &&
        this.passesThreshold(item, threshold)
      ) {
        items.push(item)
      }
    }
    return items.reverse()
  }

  async getRelevantItems(threshold: number): Promise<NewsItem[]> {
    const ids = await this.redis.zrange(`${this.keyPrefix}items`, 0, -1)
    const items: NewsItem[] = []

    for (const id of ids) {
      const item = await this.getItem(id)

      if (item && this.passesThreshold(item, threshold)) {
        items.push(item)
      }
    }

    return items
  }

  async updateRelevance(
    id: string,
    score: number,
    isRelevant: boolean
  ): Promise<void> {
    const item = await this.getItem(id)
    if (item) {
      item.relevanceScore = score
      item.isRelevant = isRelevant
      await this.writeItem(`${this.keyPrefix}item:${item.id}`, item)
    }
  }

  async markForwarded(id: string): Promise<void> {
    const item = await this.getItem(id)
    if (item) {
      item.legacyBroadcastedAt = new Date()
      await this.writeItem(`${this.keyPrefix}item:${item.id}`, item)
    }
  }

  private parseItem(data: string): NewsItem {
    const item = JSON.parse(data) as Omit<
      NewsItem,
      'publishedAt' | 'fetchedAt' | 'legacyBroadcastedAt'
    > & {
      publishedAt: string
      fetchedAt: string
      legacyBroadcastedAt?: string
    }

    return {
      ...item,
      publishedAt: new Date(item.publishedAt),
      fetchedAt: new Date(item.fetchedAt),
      legacyBroadcastedAt: item.legacyBroadcastedAt
        ? new Date(item.legacyBroadcastedAt)
        : undefined,
    }
  }

  async getRecentItems(options: {
    limit: number
    minRelevanceScore?: number
  }): Promise<NewsItem[]> {
    const { limit, minRelevanceScore } = options
    const ids = await this.redis.zrevrange(
      `${this.keyPrefix}items`,
      0,
      limit - 1
    )

    const items: NewsItem[] = []
    for (const id of ids) {
      const item = await this.getItem(id)
      if (!item) continue

      if (
        minRelevanceScore === undefined ||
        (item.relevanceScore !== undefined &&
          item.relevanceScore >= minRelevanceScore)
      ) {
        items.push(item)
      }
    }

    return items
  }

  async getItemsSince(since: Date): Promise<NewsItem[]> {
    const ids = await this.redis.zrangebyscore(
      `${this.keyPrefix}items`,
      since.getTime(),
      '+inf'
    )

    const items: NewsItem[] = []
    for (const id of ids) {
      const item = await this.getItem(id)
      if (item) {
        items.push(item)
      }
    }

    return items
  }

  private passesThreshold(item: NewsItem, threshold: number): boolean {
    return item.relevanceScore !== undefined && item.relevanceScore >= threshold
  }
}
