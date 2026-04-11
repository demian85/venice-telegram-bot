export interface MemorySummary {
  level: 'daily' | 'weekly' | 'monthly'
  chatId: string
  startTime: number
  endTime: number
  summary: string
  messageCount: number
  keyTopics: string[]
  createdAt: number
}

export interface MemoryConfig {
  recentBufferSize: number
  dailySummaryInterval: number
  weeklySummaryInterval: number
  monthlySummaryInterval: number
}

export const defaultMemoryConfig: MemoryConfig = {
  recentBufferSize: 15,
  dailySummaryInterval: 24 * 60 * 60 * 1000,
  weeklySummaryInterval: 7 * 24 * 60 * 60 * 1000,
  monthlySummaryInterval: 30 * 24 * 60 * 60 * 1000,
}

export interface HierarchicalContext {
  recentMessages: { role: string; content: string }[]
  dailySummaries: MemorySummary[]
  weeklySummaries: MemorySummary[]
  monthlySummaries: MemorySummary[]
}
