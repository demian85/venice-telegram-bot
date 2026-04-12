import { ChatOpenAI } from '@langchain/openai'

export interface VeniceModelConfig {
  modelName?: string
  temperature?: number
  maxTokens?: number
  apiKey?: string
  baseURL?: string
}

export type VeniceModelRole = 'chat' | 'summarizer' | 'newsRelevance'

export interface VeniceRoleModelDefinition {
  role: VeniceModelRole
  modelName: string
  supportsVision: boolean
}

export type VeniceRoleModels = Record<VeniceModelRole, ChatOpenAI>

type ChatOpenAIWithModelMetadata = ChatOpenAI & {
  model?: string
  modelName?: string
  lc_kwargs?: {
    model?: string
    modelName?: string
  }
}

const DEFAULT_VENICE_MODEL = 'mistral-31-24b'
const VENICE_BASE_URL = 'https://api.venice.ai/api/v1'

export const veniceRoleModelDefinitions: Record<
  VeniceModelRole,
  VeniceRoleModelDefinition
> = {
  chat: {
    role: 'chat',
    modelName: 'olafangensan-glm-4.7-flash-heretic',
    supportsVision: false,
  },
  summarizer: {
    role: 'summarizer',
    modelName: 'qwen3-5-35b-a3b',
    supportsVision: true,
  },
  newsRelevance: {
    role: 'newsRelevance',
    modelName: 'qwen3-5-35b-a3b',
    supportsVision: true,
  },
}

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
    // temperature: config.temperature ?? 0.7,
    // maxTokens: config.maxTokens ?? 2000,
  })
}

export function createVeniceModelWithConfig(
  config: Partial<VeniceModelConfig>
): ChatOpenAI {
  return createVeniceModel(config)
}

export function createVeniceRoleModel(role: VeniceModelRole): ChatOpenAI {
  return createVeniceModel({
    modelName: veniceRoleModelDefinitions[role].modelName,
  })
}

export function createVeniceRoleModels(): VeniceRoleModels {
  return {
    chat: createVeniceRoleModel('chat'),
    summarizer: createVeniceRoleModel('summarizer'),
    newsRelevance: createVeniceRoleModel('newsRelevance'),
  }
}

export function getVeniceModelName(model: ChatOpenAI): string | undefined {
  const typedModel = model as ChatOpenAIWithModelMetadata

  return (
    typedModel.modelName ??
    typedModel.model ??
    typedModel.lc_kwargs?.modelName ??
    typedModel.lc_kwargs?.model
  )
}

export function getVeniceRoleModelDefinitionForModel(
  model: ChatOpenAI
): VeniceRoleModelDefinition | null {
  const modelName = getVeniceModelName(model)

  if (!modelName) {
    return null
  }

  return (
    Object.values(veniceRoleModelDefinitions).find(
      (definition) => definition.modelName === modelName
    ) ?? null
  )
}

export function modelSupportsVision(model: ChatOpenAI): boolean {
  return getVeniceRoleModelDefinitionForModel(model)?.supportsVision ?? false
}
