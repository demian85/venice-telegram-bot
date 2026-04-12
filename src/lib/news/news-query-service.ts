import type { Redis } from 'ioredis'
import type { NewsItem } from './types'

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
}

export class NewsQueryService {
  private readonly redis: Redis
  private readonly relevanceThreshold: number
  private readonly keyPrefix = 'news:'

  constructor(config: NewsQueryServiceConfig) {
    this.redis = config.redis
    this.relevanceThreshold = config.relevanceThreshold
  }

  async getRecentNews(limit: number): Promise<RecentNewsItem[]> {
    const clampedLimit = Math.max(1, Math.min(10, limit))
    const ids = await this.redis.zrevrange(
      `${this.keyPrefix}items`,
      0,
      clampedLimit - 1
    )

    const items: RecentNewsItem[] = []
    for (const id of ids) {
      const item = await this.getNewsItem(id)
      if (
        item &&
        item.relevanceScore !== undefined &&
        item.relevanceScore >= this.relevanceThreshold
      ) {
        items.push(item)
      }
    }

    return items
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
