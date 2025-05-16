import OpenAI from 'openai'

export interface VeniceResponseError {
  details?: string
  error?: string
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
      supportsLogProbs: boolean
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

export interface ImageGenerationParams {
  model: string
  prompt: string
  cfg_scale?: number
  embed_exif_metadata?: boolean
  format?: 'jpeg' | 'png' | 'webp'
  height?: number
  hide_watermark?: boolean
  inpaint?: {
    source_image_base64: string
    strength: number
    mask?: unknown
  }
  lora_strength?: number
  negative_prompt?: string
  safe_mode?: boolean
  steps?: number
  style_preset?: string
  width?: number
}

export interface ImageGenerationResponse {
  id: string
  images: string[]
  request?: string
  timing: {
    inferenceDuration: number
    inferencePreprocessingTime: number
    inferenceQueueTime: number
    total: number
  }
}

export interface TextCompletionRequest
  extends OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  venice_parameters?: {
    enable_web_search?: 'auto' | 'on' | 'off'
    strip_thinking_response?: boolean
  }
}

export interface TextCompletionResponse
  extends OpenAI.Chat.Completions.ChatCompletion {
  venice_parameters: {
    include_venice_system_prompt: boolean
    web_search_citations: {
      title: string
      url: string
      content?: string
      date?: string
    }[]
  }
}
