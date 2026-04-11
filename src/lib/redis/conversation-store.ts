import type { Redis } from 'ioredis'

export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  timestamp: number
}

export class ConversationStore {
  private readonly keyPrefix = 'conversation:'

  constructor(private readonly redis: Redis) {}

  async getHistory(
    chatId: string,
    limit?: number
  ): Promise<ConversationMessage[]> {
    const key = this.getKey(chatId)
    const messages = await this.redis.lrange(key, 0, -1)

    const parsed: ConversationMessage[] = []
    for (const msg of messages) {
      try {
        parsed.push(JSON.parse(msg))
      } catch {
        continue
      }
    }

    const sorted = parsed.sort((a, b) => a.timestamp - b.timestamp)

    if (limit && limit > 0) {
      return sorted.slice(-limit)
    }

    return sorted
  }

  async addMessage(
    chatId: string,
    message: ConversationMessage
  ): Promise<void> {
    const key = this.getKey(chatId)
    await this.redis.lpush(key, JSON.stringify(message))
  }

  async clearHistory(chatId: string): Promise<void> {
    const key = this.getKey(chatId)
    await this.redis.del(key)
  }

  async getHistoryCount(chatId: string): Promise<number> {
    const key = this.getKey(chatId)
    return this.redis.llen(key)
  }

  private getKey(chatId: string): string {
    return `${this.keyPrefix}${chatId}`
  }
}
