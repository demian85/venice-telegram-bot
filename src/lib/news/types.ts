export interface NewsItem {
  id: string
  source: string
  feedUrl: string
  title: string
  description?: string
  content?: string
  url: string
  publishedAt: Date
  fetchedAt: Date
  relevanceScore?: number
  isRelevant?: boolean
  legacyBroadcastedAt?: Date
}

export interface NewsChatSubscription {
  chatId: string
  enabled: boolean
  intervalSeconds: number
  createdAt: Date
  updatedAt: Date
  deliverAfter: Date
  subscribedAt?: Date
  unsubscribedAt?: Date
  lastSentAt?: Date
}

export interface NewsDeliveryRecord {
  chatId: string
  itemId: string
  sentAt: Date
}

export interface NewsConfig {
  feeds: string[]
  pollIntervalMinutes: number
  relevanceThreshold: number
  maxArticlesPerPoll: number
  topics: string[]
}

export const defaultNewsIntervalSeconds = 300
export const minNewsIntervalSeconds = 60
export const maxNewsIntervalSeconds = 86400
