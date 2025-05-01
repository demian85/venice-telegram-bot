import { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { Context, NarrowedContext } from 'telegraf'
import {
  CallbackQuery,
  Message,
  Update,
} from 'telegraf/typings/core/types/typegram'

export type MessageContext = NarrowedContext<
  ContextWithSession<Update>,
  Update.MessageUpdate<Record<'text', unknown> & Message.TextMessage>
>

export type CallbackQueryContext = NarrowedContext<
  ContextWithSession,
  Update.CallbackQueryUpdate<CallbackQuery>
>

export interface CurrentCommand {
  id: string
  step: number
  subcommand?: string
  data?: string
}

export interface Session {
  currentCommand: CurrentCommand | null
}

export interface ContextWithSession<U extends Update = Update>
  extends Context<U> {
  session: {
    currentCommand: CurrentCommand | null
    config: {
      model: string
      maxTokens: number
    }
    messages: ChatCompletionMessageParam[]
  }
}

export interface Handler {
  message: Array<(ctx: MessageContext) => Promise<void>>
  callbackQuery: Array<(ctx: CallbackQueryContext) => Promise<void>>
}
