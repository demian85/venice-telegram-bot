import { Config, ModelData } from '@lib/types'
import { Session } from './types'

const defaultTextModel: ModelData = {
  id: 'mistral-31-24b',
  model_spec: {
    pricing: {
      input: {
        usd: 0.5,
        vcu: 5,
      },
      output: {
        usd: 2,
        vcu: 20,
      },
    },
    availableContextTokens: 131072,
    capabilities: {
      optimizedForCode: false,
      quantization: 'fp16',
      supportsFunctionCalling: true,
      supportsReasoning: false,
      supportsResponseSchema: true,
      supportsVision: true,
      supportsWebSearch: true,
      supportsLogProbs: false,
    },
    constraints: {
      temperature: {
        default: 0.15,
      },
      top_p: {
        default: 0.9,
      },
    },
    modelSource:
      'https://huggingface.co/mistralai/Mistral-Small-3.1-24B-Instruct-2503',
    offline: false,
    traits: ['default_vision'],
  },
  object: 'model',
  owned_by: 'venice.ai',
  type: 'text',
}

const defaultImageModel: ModelData = {
  created: 1743099022,
  id: 'venice-sd35',
  model_spec: {
    pricing: {
      generation: {
        usd: 0.01,
        vcu: 0.1,
      },
      upscale: {
        '2x': {
          usd: 0.02,
          vcu: 0.2,
        },
        '4x': {
          usd: 0.08,
          vcu: 0.8,
        },
      },
    },
    constraints: {
      promptCharacterLimit: 1500,
      steps: {
        default: 25,
        max: 30,
      },
      widthHeightDivisor: 16,
    },
    modelSource:
      'https://huggingface.co/stabilityai/stable-diffusion-3.5-large',
    offline: false,
    traits: ['default', 'eliza-default'],
  },
  object: 'model',
  owned_by: 'venice.ai',
  type: 'image',
}

const defaultCodingModel: ModelData = {
  created: 1740253117,
  id: 'deepseek-coder-v2-lite',
  model_spec: {
    pricing: {
      input: {
        usd: 0.5,
        vcu: 5,
      },
      output: {
        usd: 2,
        vcu: 20,
      },
    },
    availableContextTokens: 131072,
    capabilities: {
      optimizedForCode: true,
      quantization: 'fp16',
      supportsFunctionCalling: false,
      supportsReasoning: false,
      supportsResponseSchema: true,
      supportsVision: false,
      supportsWebSearch: false,
      supportsLogProbs: false,
    },
    constraints: {
      temperature: {
        default: 0.8,
      },
      top_p: {
        default: 0.9,
      },
    },
    modelSource:
      'https://huggingface.co/deepseek-ai/deepseek-coder-v2-lite-Instruct',
    offline: false,
    traits: [],
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
