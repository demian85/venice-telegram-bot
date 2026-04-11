import { ChatOpenAI } from '@langchain/openai'
import type { ConversationMessage } from '../redis/conversation-store'
import type { MemorySummary } from './types'

export class Summarizer {
  private readonly model: ChatOpenAI

  constructor(model: ChatOpenAI) {
    this.model = model
  }

  async generateSummary(
    chatId: string,
    messages: ConversationMessage[],
    level: 'daily' | 'weekly' | 'monthly',
    startTime: number,
    endTime: number
  ): Promise<MemorySummary> {
    const conversationText = messages
      .filter((m) => m.role !== 'system')
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n')

    const levelDescriptions = {
      daily: 'day',
      weekly: 'week',
      monthly: 'month',
    }

    const prompt = `Summarize the following conversation from the past ${levelDescriptions[level]} in 2-3 sentences.
Focus on: key topics discussed, important decisions made, and any action items.
Be concise but capture essential context for future reference.

Conversation:
${conversationText}

Summary:`

    try {
      const response = await this.model.invoke(prompt)
      const summaryText =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content)

      const topics = this.extractTopics(messages)

      return {
        level,
        chatId,
        startTime,
        endTime,
        summary: summaryText.trim(),
        messageCount: messages.length,
        keyTopics: topics,
        createdAt: Date.now(),
      }
    } catch (error) {
      console.error('Summary generation failed:', error)
      return {
        level,
        chatId,
        startTime,
        endTime,
        summary: `Conversation summary unavailable for ${levelDescriptions[level]}.`,
        messageCount: messages.length,
        keyTopics: [],
        createdAt: Date.now(),
      }
    }
  }

  private extractTopics(messages: ConversationMessage[]): string[] {
    const topics = new Set<string>()
    const content = messages.map((m) => m.content.toLowerCase()).join(' ')

    const commonTopics = [
      'ai',
      'artificial intelligence',
      'machine learning',
      'model',
      'code',
      'programming',
      'development',
      'bug',
      'feature',
      'meeting',
      'schedule',
      'deadline',
      'plan',
      'project',
      'question',
      'help',
      'issue',
      'problem',
      'solution',
      'telegram',
      'bot',
      'venice',
      'api',
    ]

    for (const topic of commonTopics) {
      if (content.includes(topic)) {
        topics.add(topic)
      }
    }

    return Array.from(topics).slice(0, 5)
  }
}
