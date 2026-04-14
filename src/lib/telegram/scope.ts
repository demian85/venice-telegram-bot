import { Context } from 'telegraf'
import type { Update } from 'telegraf/types'

export type TelegramChatScopeType = 'private' | 'group'

export function getNormalizedChatType(
  chatType?: string
): TelegramChatScopeType | null {
  if (chatType === 'private') {
    return 'private'
  }

  if (chatType === 'group' || chatType === 'supergroup') {
    return 'group'
  }

  return null
}

export function getChatScopeKey(
  chatType: TelegramChatScopeType,
  chatId: string | number
): string {
  return `${chatType}:${chatId}`
}

export function getContextChatScope(
  ctx: Context<Update>
): { chatType: TelegramChatScopeType; chatScope: string } | null {
  const normalizedChatType = getNormalizedChatType(ctx.chat?.type)
  const chatId = ctx.chat?.id

  if (!normalizedChatType || chatId === undefined) {
    return null
  }

  return {
    chatType: normalizedChatType,
    chatScope: getChatScopeKey(normalizedChatType, chatId),
  }
}
