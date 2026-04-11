import type { Redis } from 'ioredis'
import type { MemorySummary } from './types'

export class SummaryStore {
  private readonly redis: Redis
  private readonly keyPrefix = 'memory:summary:'

  constructor(redis: Redis) {
    this.redis = redis
  }

  private getKey(chatId: string, level: string): string {
    return `${this.keyPrefix}${chatId}:${level}`
  }

  async saveSummary(summary: MemorySummary): Promise<void> {
    const key = this.getKey(summary.chatId, summary.level)
    const score = summary.endTime
    const data = JSON.stringify(summary)
    await this.redis.zadd(key, score, data)
  }

  async getSummaries(
    chatId: string,
    level: 'daily' | 'weekly' | 'monthly',
    limit: number = 10
  ): Promise<MemorySummary[]> {
    const key = this.getKey(chatId, level)
    const results = await this.redis.zrevrange(key, 0, limit - 1)
    return results.map((r) => JSON.parse(r)).reverse()
  }

  async getSummariesInRange(
    chatId: string,
    level: 'daily' | 'weekly' | 'monthly',
    startTime: number,
    endTime: number
  ): Promise<MemorySummary[]> {
    const key = this.getKey(chatId, level)
    const results = await this.redis.zrangebyscore(key, startTime, endTime)
    return results.map((r) => JSON.parse(r))
  }

  async getLastSummary(
    chatId: string,
    level: 'daily' | 'weekly' | 'monthly'
  ): Promise<MemorySummary | null> {
    const key = this.getKey(chatId, level)
    const results = await this.redis.zrevrange(key, 0, 0)
    if (!results.length) return null
    return JSON.parse(results[0])
  }

  async shouldGenerateSummary(
    chatId: string,
    level: 'daily' | 'weekly' | 'monthly',
    interval: number
  ): Promise<boolean> {
    const last = await this.getLastSummary(chatId, level)
    if (!last) return true
    return Date.now() - last.endTime >= interval
  }

  async getMessageCountSince(
    chatId: string,
    timestamp: number
  ): Promise<number> {
    const key = `conversation:${chatId}`
    const messages = await this.redis.lrange(key, 0, -1)
    let count = 0
    for (const msg of messages) {
      try {
        const parsed = JSON.parse(msg)
        if (parsed.timestamp > timestamp && parsed.role !== 'system') {
          count++
        }
      } catch {
        continue
      }
    }
    return count
  }
}
