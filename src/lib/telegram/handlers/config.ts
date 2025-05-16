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
      const keyboardButtons = [
        {
          text: 'Text Model',
          callback_data: 'text_model',
        },
        {
          text: 'Image Model',
          callback_data: 'image_model',
        },
        {
          text: 'Coding Model',
          callback_data: 'coding_model',
        },
      ]
      await ctx.reply(`Choose an option`, {
        reply_markup: { inline_keyboard: [keyboardButtons] },
      })
    },
  ],
  callbackQuery: [
    // step = 0
    async (ctx: CallbackQueryContext) => {
      const callbackValue = (ctx.callbackQuery as CallbackQuery.DataQuery).data

      ctx.session.currentCommand!.step = 1
      ctx.session.currentCommand!.subcommand = callbackValue

      try {
        let availableModels
        let selectedModelId

        if (callbackValue === 'text_model') {
          availableModels = await listModels('text')
          selectedModelId = ctx.session.config.textModel.id
        } else if (callbackValue === 'image_model') {
          availableModels = await listModels('image')
          selectedModelId = ctx.session.config.imageModel.id
        } else if (callbackValue === 'coding_model') {
          availableModels = await listModels('code')
          selectedModelId = ctx.session.config.codingModel.id
        }

        if (!availableModels) {
          return callbackError(ctx, 'No available models')
        }

        ctx.session.availableModels = availableModels.data

        await ctx.editMessageReplyMarkup({
          inline_keyboard: buildModelKeyboardButtons(
            availableModels.data,
            selectedModelId
          ),
        })
        await ctx.answerCbQuery()
      } catch (err) {
        const error = err as Error
        logger.error(error)
        return callbackError(ctx, error.message)
      }
    },

    // step = 1
    async (ctx: CallbackQueryContext) => {
      const callbackValue = (ctx.callbackQuery as CallbackQuery.DataQuery).data
      const selectedModel = ctx.session.availableModels.find((model) => {
        return model.id === callbackValue
      })

      if (!selectedModel) {
        return callbackError(ctx, 'Invalid model selected')
      }

      const selectedModelName = modelNameMappings[selectedModel.id]
      const emptyKeyboard = { inline_keyboard: [] }

      switch (ctx.session.currentCommand?.subcommand) {
        case 'text_model': {
          ctx.session.config.textModel = selectedModel
          await ctx.answerCbQuery('')
          await ctx.editMessageText(
            `The new text model is *${selectedModelName}*`,
            { reply_markup: emptyKeyboard, parse_mode: 'Markdown' }
          )
          return cancelCommand(ctx)
        }
        case 'image_model': {
          ctx.session.config.imageModel = selectedModel
          await ctx.answerCbQuery('')
          await ctx.editMessageText(
            `The new image model is *${selectedModelName}*`,
            { reply_markup: emptyKeyboard, parse_mode: 'Markdown' }
          )
          return cancelCommand(ctx)
        }
        case 'coding_model': {
          ctx.session.config.codingModel = selectedModel
          await ctx.answerCbQuery('')
          await ctx.editMessageText(
            `The new coding model is *${selectedModelName}*`,
            { reply_markup: emptyKeyboard, parse_mode: 'Markdown' }
          )
          return cancelCommand(ctx)
        }
        default:
          return callbackError(ctx)
      }
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
