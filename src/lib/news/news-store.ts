import type { Redis } from 'ioredis'
import type { NewsItem } from './types'

export class NewsStore {
  private readonly redis: Redis
  private readonly keyPrefix = 'news:'

  constructor(redis: Redis) {
    this.redis = redis
  }

  async storeItem(item: NewsItem): Promise<void> {
    const key = `${this.keyPrefix}item:${item.id}`
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
    return JSON.parse(data)
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
        item.isRelevant &&
        !item.isForwarded &&
        item.relevanceScore &&
        item.relevanceScore >= threshold
      ) {
        items.push(item)
      }
    }
    return items.reverse()
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
      await this.storeItem(item)
    }
  }

  async markForwarded(id: string): Promise<void> {
    const item = await this.getItem(id)
    if (item) {
      item.isForwarded = true
      await this.storeItem(item)
    }
  }
}
