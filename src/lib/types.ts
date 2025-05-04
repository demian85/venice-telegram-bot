export interface OpenAIResponseError {
  message: string
  response?: {
    status: string
    data: unknown
  }
}

export interface Config {
  telegram: {
    botUsername: string
    whitelistedUsers: string[]
    maxSessionMessages: number
  }
  ia: {
    defaultMaxTokens: number
    privateChatSystemPrompt: string
    groupChatSystemPrompt: string
  }
}

interface ImageModelConstraints {
  promptCharacterLimit: number
  steps: {
    default: number
    max: number
  }
  widthHeightDivisor: number
}

interface TextModelConstraints {
  temperature: {
    default: number
  }
  top_p: {
    default: number
  }
}

export type ModelType =
  | 'text'
  | 'code'
  | 'image'
  | 'tts'
  | 'embedding'
  | 'upscale'

export interface ModelData {
  id: string
  created?: number
  model_spec: {
    availableContextTokens?: number
    capabilities?: {
      optimizedForCode: boolean
      quantization: string
      supportsFunctionCalling: boolean
      supportsReasoning: boolean
      supportsResponseSchema: boolean
      supportsVision: boolean
      supportsWebSearch: boolean
    }
    constraints?: ImageModelConstraints | TextModelConstraints
    modelSource?: string
    offline?: boolean
    pricing?: Record<string, unknown>
    traits?: string[]
    voices?: string[]
  }
  object: string
  owned_by: string
  type: ModelType
}

export interface ModelList {
  data: ModelData[]
}
