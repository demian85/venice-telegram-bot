import type { ChatOpenAI } from '@langchain/openai'
import logger from '@lib/logger.js'
import type { NewsConfig, NewsItem } from './types.js'

export class RelevanceDetector {
  private readonly model: ChatOpenAI
  private readonly topics: NewsConfig['topics']
  private readonly relevanceThreshold: NewsConfig['relevanceThreshold']

  constructor(
    model: ChatOpenAI,
    config: Pick<NewsConfig, 'topics' | 'relevanceThreshold'>
  ) {
    this.model = model
    this.topics = config.topics
    this.relevanceThreshold = config.relevanceThreshold
  }

  async detectRelevance(
    item: NewsItem
  ): Promise<{ score: number; isRelevant: boolean }> {
    const content =
      `${item.title}\n${item.description || ''}\n${item.content || ''}`.slice(
        0,
        2000
      )

    const prompt = `Analyze this article and rate its relevance to the following topics on a scale of 0-100.

Article: ${content}

Topics of interest: ${this.topics.join(', ')}

Respond with ONLY a number between 0-100, where:
- 80-100: Highly relevant (directly covers these topics)
- 60-79: Somewhat relevant (mentions these topics in passing)
- 0-59: Not relevant (unrelated to these topics)

Score:`

    try {
      const response = await this.model.invoke(prompt)
      const text =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content)
      const match = text.match(/\d+/)
      const score = match
        ? Math.min(100, Math.max(0, parseInt(match[0], 10)))
        : 50
      const isRelevant = score >= this.relevanceThreshold

      logger.debug({
        event: 'news.score.result',
        itemId: item.id,
        itemTitle: item.title,
        score,
        isRelevant,
        threshold: this.relevanceThreshold,
      })

      return {
        score,
        isRelevant,
      }
    } catch (error) {
      logger.error({
        event: 'news.score.error',
        itemId: item.id,
        itemTitle: item.title,
        threshold: this.relevanceThreshold,
        err: error,
      })

      return { score: 0, isRelevant: false }
    }
  }

  async batchDetectRelevance(
    items: NewsItem[]
  ): Promise<Map<string, { score: number; isRelevant: boolean }>> {
    const results = new Map<string, { score: number; isRelevant: boolean }>()

    logger.debug({
      event: 'news.score.start',
      unscoredCount: items.length,
      threshold: this.relevanceThreshold,
      topicCount: this.topics.length,
    })

    await Promise.all(
      items.map(async (item) => {
        const result = await this.detectRelevance(item)
        results.set(item.id, result)
      })
    )
    return results
  }
}
