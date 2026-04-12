import { Context, NarrowedContext } from 'telegraf'
import type { Message, Update, MessageEntity } from 'telegraf/types'

export type MessageContext = NarrowedContext<
  TelegramContext<Update>,
  Update.MessageUpdate<Record<'text', unknown> & Message.TextMessage>
>

export type PhotoMessageContext = NarrowedContext<
  TelegramContext<Update>,
  Update.MessageUpdate<Record<'photo', unknown> & Message.PhotoMessage>
>

export interface TelegramContext<U extends Update = Update> extends Context<U> {
  chatType: 'private' | 'group'
  chatScope: string
  isMention: boolean
  parsedMessageText?: string
}

export type { Message, Update, MessageEntity }
