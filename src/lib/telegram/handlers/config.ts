import { CallbackQuery } from 'telegraf/typings/core/types/typegram'
import { CallbackQueryContext, MessageContext } from '../types'
import { callbackError, cancelCommand } from './util'
import { listModels } from '@lib/api'
import { ModelData } from '@lib/types'
import logger from '@lib/logger'

const modelNameMappings: Record<string, string> = {
  // text models
  'llama-4-maverick-17b': 'Llama 4 Maverick 256K - Vision',
  'qwen3-235b': 'Large 32K - Most Intelligent',
  'mistral-31-24b': 'Medium 128K - Vision',
  'qwen3-4b': 'Small 128K - Fastest',
  'qwen-2.5-qwq-32b': 'Reasoning 32K',
  'venice-uncensored': 'Uncensored 32K',

  // image models
  'venice-sd35': 'Venice SD35 - Most artistic',
  'flux-dev': 'FLUX Standard - Highest quality',
  'flux-dev-uncensored': 'FLUX Custom - Uncensored',
  'lustify-sdxl': 'Lustify SDXL - Uncensored',
  'pony-realism': 'Pony Realism - Uncensored',

  // code models
  'deepseek-coder-v2-lite': 'Deepseek Coder V2 Lite 128K',
  'qwen-2.5-coder-32b': 'Qwen 2.5 Coder 32B',
}

export default {
  message: [
    // step = 0
    async (ctx: MessageContext) => {
      ctx.session.currentCommand = { id: 'config', step: 0 }

      try {
        const availableModels = await listModels('text')
        if (!availableModels) {
          return ctx.reply('No available models')
        }

        ctx.session.availableModels = availableModels.data
        const selectedModelId = ctx.session.config.model?.id

        await ctx.reply('Select your preferred model:', {
          reply_markup: {
            inline_keyboard: buildModelKeyboardButtons(
              availableModels.data,
              selectedModelId
            ),
          },
        })
      } catch (err) {
        const error = err as Error
        logger.error(error)
        return ctx.reply(`Error loading models: ${error.message}`)
      }
    },
  ],
  callbackQuery: [
    async (ctx: CallbackQueryContext) => {
      const callbackValue = (ctx.callbackQuery as CallbackQuery.DataQuery).data
      const selectedModel = ctx.session.availableModels.find((model) => {
        return model.id === callbackValue
      })

      if (!selectedModel) {
        return callbackError(ctx, 'Invalid model selected')
      }

      const selectedModelName =
        modelNameMappings[selectedModel.id] || selectedModel.id
      const emptyKeyboard = { inline_keyboard: [] }

      ctx.session.config.model = selectedModel
      await ctx.answerCbQuery('')
      await ctx.editMessageText(`Model updated to *${selectedModelName}*`, {
        reply_markup: emptyKeyboard,
        parse_mode: 'Markdown',
      })
      return cancelCommand(ctx)
    },
  ],
}

function buildModelKeyboardButtons(
  availableModels: ModelData[],
  selectedModelId?: string
) {
  return availableModels
    .filter((model) => !!modelNameMappings[model.id])
    .map((model) => {
      const modelName = modelNameMappings[model.id]
      const prefix = selectedModelId === model.id ? '✅ ' : ''
      return [
        {
          text: `${prefix}${modelName}`,
          callback_data: model.id,
        },
      ]
    })
}
