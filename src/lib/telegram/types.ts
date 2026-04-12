import { Context, NarrowedContext } from 'telegraf'
import { Message, Update } from 'telegraf/typings/core/types/typegram'

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
