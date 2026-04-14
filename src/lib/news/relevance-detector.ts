import { z } from 'zod'
import type { ChatOpenAI } from '@langchain/openai'
import logger from '@lib/logger.js'
import type { NewsConfig, NewsItem } from './types.js'

const RelevanceScoreSchema = z.object({
  score: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe(
      'Relevance score from 0-100 where 80-100 is highly relevant, 60-79 somewhat relevant, 0-59 not relevant'
    ),
  reasoning: z
    .string()
    .nullable()
    .describe('Brief explanation of why this score was given'),
})

type RelevanceScore = z.infer<typeof RelevanceScoreSchema>

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
    logger.trace(
      {
        event: 'news.score.start',
        itemId: item.id,
        itemTitle: item.title.slice(0, 50),
      },
      'Starting relevance scoring'
    )

    const startTime = Date.now()
    const content =
      `${item.title}\n${item.description || ''}\n${item.content || ''}`.slice(
        0,
        2000
      )

    const prompt = `Analyze this article and rate its relevance on a scale of 0-100, based on the topics of interest.

Article: ${content}

Topics of interest: ${this.topics.join(', ')}

Scoring guidelines:
- 80-100: Highly relevant (directly covers most of the topics)
- 60-79: Somewhat relevant (mentions a few topics)
- 0-59: Not relevant (unrelated to these topics)`

    try {
      const structuredModel =
        this.model.withStructuredOutput(RelevanceScoreSchema)
      const result: RelevanceScore = await structuredModel.invoke(prompt)
      const score = Math.min(100, Math.max(0, result.score))
      const isRelevant = score >= this.relevanceThreshold
      const duration = Date.now() - startTime

      logger.info({
        event: 'news.score.result',
        itemId: item.id,
        itemTitle: item.title.slice(0, 50),
        score,
        isRelevant,
        threshold: this.relevanceThreshold,
        durationMs: duration,
      })

      logger.trace(
        {
          event: 'news.score.complete',
          itemId: item.id,
          durationMs: duration,
          score,
        },
        'Relevance scoring completed'
      )

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

    logger.info({
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
