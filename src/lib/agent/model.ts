import { ChatOpenAI } from '@langchain/openai'

export interface VeniceModelConfig {
  modelName?: string
  temperature?: number
  maxTokens?: number
  apiKey?: string
  baseURL?: string
}

const DEFAULT_VENICE_MODEL = 'mistral-31-24b'
const VENICE_BASE_URL = 'https://api.venice.ai/api/v1'

export function createVeniceModel(config: VeniceModelConfig = {}): ChatOpenAI {
  const apiKey = config.apiKey || process.env.VENICE_API_KEY

  if (!apiKey) {
    throw new Error('VENICE_API_KEY environment variable is required')
  }

  return new ChatOpenAI({
    modelName: config.modelName || DEFAULT_VENICE_MODEL,
    apiKey,
    configuration: {
      baseURL: config.baseURL || VENICE_BASE_URL,
    },
    temperature: config.temperature ?? 0.7,
    maxTokens: config.maxTokens ?? 2000,
  })
}

export function createVeniceModelWithConfig(
  config: Partial<VeniceModelConfig>
): ChatOpenAI {
  return createVeniceModel(config)
}
