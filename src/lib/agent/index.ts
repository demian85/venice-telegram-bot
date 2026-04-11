import { createAgent, type ReactAgent } from 'langchain'
import { ChatOpenAI } from '@langchain/openai'
import type { StructuredTool } from '@langchain/core/tools'
import type { Redis } from 'ioredis'
import {
  ConversationStore,
  type ConversationMessage,
} from '../redis/conversation-store'

export interface AgentServiceConfig {
  redis: Redis
  model: ChatOpenAI
  tools: StructuredTool[]
  systemPrompt?: string
}

export class AgentService {
  private readonly store: ConversationStore
  private readonly model: ChatOpenAI
  private readonly tools: StructuredTool[]
  private readonly systemPrompt: string
  private agent: ReactAgent | null = null

  constructor(config: AgentServiceConfig) {
    this.store = new ConversationStore(config.redis)
    this.model = config.model
    this.tools = config.tools
    this.systemPrompt = config.systemPrompt || this.getDefaultSystemPrompt()
  }

  async initialize(): Promise<void> {
    this.agent = createAgent({
      model: this.model,
      tools: this.tools,
    })
  }

  async invoke(chatId: string, message: string): Promise<string> {
    if (!this.agent) {
      throw new Error('Agent not initialized. Call initialize() first.')
    }

    const history = await this.store.getHistory(chatId, 50)

    const messages: ConversationMessage[] = [
      { role: 'system', content: this.systemPrompt, timestamp: Date.now() },
      ...history,
      { role: 'user', content: message, timestamp: Date.now() },
    ]

    await this.store.addMessage(chatId, {
      role: 'user',
      content: message,
      timestamp: Date.now(),
    })

    try {
      const result = await this.agent.invoke({
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      })

      const lastMessage = result.messages[result.messages.length - 1]
      const responseText =
        typeof lastMessage.content === 'string'
          ? lastMessage.content
          : JSON.stringify(lastMessage.content)

      await this.store.addMessage(chatId, {
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
      })

      return responseText
    } catch (error) {
      console.error('Agent invoke error:', error)
      throw error
    }
  }

  async getHistory(chatId: string): Promise<ConversationMessage[]> {
    return this.store.getHistory(chatId)
  }

  async clearHistory(chatId: string): Promise<void> {
    return this.store.clearHistory(chatId)
  }

  private getDefaultSystemPrompt(): string {
    return `You are a helpful AI assistant powered by Venice AI. You have access to tools that can help answer questions and perform tasks.

When using tools:
- Always use the calculator for mathematical calculations
- Provide clear, concise responses
- If you're unsure about something, say so
- Be friendly and helpful in your interactions`
  }
}

export function createAgentService(config: AgentServiceConfig): AgentService {
  return new AgentService(config)
}
