import { Config, ModelData } from '@lib/types'
import { Session } from './types'

const defaultTextModel: ModelData = {
  id: 'llama-4-maverick-17b',
  model_spec: {
    availableContextTokens: 262144,
    capabilities: {
      optimizedForCode: false,
      quantization: 'fp8',
      supportsFunctionCalling: true,
      supportsReasoning: false,
      supportsResponseSchema: true,
      supportsVision: true,
      supportsWebSearch: true,
    },
  },
  object: 'model',
  owned_by: 'venice.ai',
  type: 'text',
}

const defaultImageModel: ModelData = {
  id: 'venice-sd35',
  model_spec: {},
  object: 'model',
  owned_by: 'venice.ai',
  type: 'image',
}

const defaultCodingModel: ModelData = {
  id: 'deepseek-coder-v2-lite',
  model_spec: {
    availableContextTokens: 131072,
    capabilities: {
      optimizedForCode: true,
      quantization: 'fp16',
      supportsFunctionCalling: false,
      supportsReasoning: false,
      supportsResponseSchema: true,
      supportsVision: false,
      supportsWebSearch: false,
    },
  },
  object: 'model',
  owned_by: 'venice.ai',
  type: 'text',
}

export const defaultSession: Session = {
  currentCommand: null,
  config: {
    textModel: defaultTextModel,
    imageModel: defaultImageModel,
    codingModel: defaultCodingModel,
  },
  messages: [],
  availableModels: [],
}

export const defaultConfig: Config = {
  telegram: {
    botUsername: '',
    whitelistedUsers: [],
    maxSessionMessages: 100,
  },
  ia: {
    defaultMaxTokens: 256000,
    privateChatSystemPrompt:
      'You are a Telegram bot assistant. Keep responses short and concise when possible.',
    groupChatSystemPrompt:
      'You are an assistant in a Telegram group. Give short and concise responses only when necessary. Every message is prepended with the name of the user.',
  },
}
