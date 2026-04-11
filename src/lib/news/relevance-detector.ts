import type { ChatOpenAI } from '@langchain/openai'
import type { NewsItem } from './types'

export class RelevanceDetector {
  private readonly model: ChatOpenAI

  constructor(model: ChatOpenAI) {
    this.model = model
  }

  async detectRelevance(
    item: NewsItem,
    topics: string[] = [
      'AI',
      'artificial intelligence',
      'machine learning',
      'LLM',
      'neural networks',
      'OpenAI',
      'Anthropic',
      'Claude',
      'GPT',
    ]
  ): Promise<{ score: number; isRelevant: boolean }> {
    const content =
      `${item.title}\n${item.description || ''}\n${item.content || ''}`.slice(
        0,
        2000
      )

    const prompt = `Analyze this article and rate its relevance to AI/artificial intelligence topics on a scale of 0-100.

Article: ${content}

Topics of interest: ${topics.join(', ')}

Respond with ONLY a number between 0-100, where:
- 80-100: Highly relevant (directly about AI breakthroughs, new models, industry news)
- 60-79: Moderately relevant (mentions AI in passing, related tech news)
- 0-59: Not relevant (unrelated topics)

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
      return {
        score,
        isRelevant: score >= 70,
      }
    } catch (error) {
      console.error('Relevance detection failed:', error)
      return { score: 0, isRelevant: false }
    }
  }

  async batchDetectRelevance(
    items: NewsItem[]
  ): Promise<Map<string, { score: number; isRelevant: boolean }>> {
    const results = new Map<string, { score: number; isRelevant: boolean }>()
    await Promise.all(
      items.map(async (item) => {
        const result = await this.detectRelevance(item)
        results.set(item.id, result)
      })
    )
    return results
  }
}
