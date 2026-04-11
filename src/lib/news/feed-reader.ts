import { extract } from '@extractus/feed-extractor'
import type { NewsItem } from './types'

export interface FeedEntry {
  title?: string
  description?: string
  link?: string
  published?: string
  content?: string
}

export class FeedReader {
  private readonly seenUrls: Set<string> = new Set()

  async fetchFeed(url: string): Promise<NewsItem[]> {
    try {
      const feed = await extract(url)

      if (!feed?.entries) {
        return []
      }

      const items: NewsItem[] = []
      const now = new Date()

      for (const entry of feed.entries) {
        const feedEntry = entry as unknown as FeedEntry
        const link = feedEntry.link || ''

        if (this.seenUrls.has(link)) {
          continue
        }

        const item: NewsItem = {
          id: `${link}:${Date.now()}`,
          source: feed.title || link,
          feedUrl: link,
          title: feedEntry.title || 'Untitled',
          description: feedEntry.description,
          content: undefined,
          url: link,
          publishedAt: feedEntry.published ? new Date(feedEntry.published) : now,
          fetchedAt: now,
        }

        items.push(item)
        this.seenUrls.add(link)
      }

      return items
    } catch (error) {
      console.error(`Failed to fetch feed ${url}:`, error)
      return []
    }
  }

  async fetchAllFeeds(urls: string[]): Promise<NewsItem[]> {
    const results = await Promise.all(
      urls.map((url) => this.fetchFeed(url))
    )
    return results.flat().sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
  }

  markSeen(url: string): void {
    this.seenUrls.add(url)
  }

  isSeen(url: string): boolean {
    return this.seenUrls.has(url)
  }
}
