import { CallbackQueryContext, ContextWithSession } from '../types'

export async function callbackError(
  ctx: CallbackQueryContext,
  msg = 'Invalid operation'
): Promise<void> {
  await ctx.answerCbQuery(msg, { show_alert: true })
  return cancelCommand(ctx)
}

export async function cancelCommand(ctx: ContextWithSession): Promise<void> {
  ctx.session.currentCommand = null
  ctx.session.availableModels = []
}
