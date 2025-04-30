import { CallbackQuery } from 'telegraf/typings/core/types/typegram'
import { CallbackQueryContext, MessageContext } from '../types'
import { callbackError, cancelCommand } from './util'

export default {
  message: [
    // step = 0
    async (ctx: MessageContext) => {
      ctx.session.currentCommand = { id: 'config', step: 0 }
      const keyboardButtons = [
        {
          text: 'Model',
          callback_data: 'model',
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

      if (callbackValue === 'model') {
        await ctx.editMessageReplyMarkup({
          inline_keyboard: [
            [
              {
                text: 'Venice Large 256K - Vision - Web search - Most intelligent',
                callback_data: 'llama-4-maverick-17b',
              },
              {
                text: 'Venice Medium 128K - Vision - Web search',
                callback_data: 'mistral-31-24b',
              },
            ],
          ],
        })
      }

      await ctx.answerCbQuery()
    },

    // step = 1
    async (ctx: CallbackQueryContext) => {
      const callbackValue = (ctx.callbackQuery as CallbackQuery.DataQuery).data

      switch (ctx.session.currentCommand?.subcommand) {
        case 'model':
          ctx.session.config.model = callbackValue
          await ctx.answerCbQuery('')
          await ctx.editMessageText(`Your new model is ${callbackValue}`, {
            reply_markup: { inline_keyboard: [] },
          })
          return cancelCommand(ctx)
        default:
          return callbackError(ctx)
      }
    },
  ],
}
