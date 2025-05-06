import { generateImage } from '@lib/api'
import { MessageContext } from '../types'
import logger from '@lib/logger'

export default {
  message: [
    // step = 0
    async (ctx: MessageContext) => {
      ctx.session.currentCommand = { id: 'image', step: 1 }
      await ctx.reply(`Send me the specifications`)
    },
    // step = 1
    async (ctx: MessageContext) => {
      return generateImageHandler(ctx, ctx.message.text.trim())
    },
  ],
  callbackQuery: [],
}

export async function generateImageHandler(
  ctx: MessageContext,
  prompt: string
) {
  try {
    const response = await generateImage({
      model: ctx.session.config.imageModel.id,
      prompt,
    })
    await ctx.replyWithPhoto({
      source: Buffer.from(response.images[0], 'base64'),
    })
  } catch (err) {
    const error = err as Error
    logger.error(error)
    await ctx.reply(`Failed to generate image. ${error.message}`)
  }
  ctx.session.currentCommand = null
}
