import { ModelData } from '@lib/types'
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
  config: {
    textModel: ModelData
    imageModel: ModelData
    codingModel: ModelData
  }
  textModelHistory: ChatCompletionMessageParam[]
  codeModelHistory: ChatCompletionMessageParam[]
  availableModels: ModelData[]
}

export interface ContextWithSession<U extends Update = Update>
  extends Context<U> {
  session: Session
  chatType: 'private' | 'group'
  isMention: boolean
  parsedMessageText: string
}

export interface Handler {
  message: Array<(ctx: MessageContext) => Promise<void>>
  callbackQuery: Array<(ctx: CallbackQueryContext) => Promise<void>>
}
