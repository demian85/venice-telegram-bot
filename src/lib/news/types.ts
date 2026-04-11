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
  isForwarded?: boolean
}

export interface NewsConfig {
  feeds: string[]
  pollIntervalMinutes: number
  relevanceThreshold: number
  maxArticlesPerPoll: number
}

export const defaultNewsConfig: NewsConfig = {
  feeds: ['https://planet-ai.net/rss.xml', 'https://news.ycombinator.com/rss'],
  pollIntervalMinutes: 5,
  relevanceThreshold: 70,
  maxArticlesPerPoll: 10,
}
