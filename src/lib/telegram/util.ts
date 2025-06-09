import { TextCompletionResponse } from '@lib/types'
import { MessageContext } from './types'

export function escapeMarkdownV2(text: string): string {
  // Define the markdown v2 reserved characters
  const reservedChars = [
    '_',
    '*',
    '[',
    ']',
    '(',
    ')',
    '~',
    '`',
    '>',
    '#',
    '+',
    '-',
    '=',
    '|',
    '{',
    '}',
    '.',
    '!',
  ]

  reservedChars.forEach((char) => {
    text = text.replaceAll(char, '\\' + char)
  })

  return text
}

export function formatWebCitations(
  completionResponse: TextCompletionResponse,
  limit = 3
): string {
  return (
    '\n\n' +
    completionResponse.venice_parameters.web_search_citations
      .slice(0, limit)
      .map((item) => {
        return `- [${item.title}](${item.url})`
      })
      .join('\n')
  )
}

export function fullMarkdown2TgMarkdown(input: string): string {
  return input
    .replaceAll(/^#+ *(.+)$/gm, '*$1*\n')
    .replaceAll(/^--- *$/gm, '---------------')
}

export function getTextFromCommand(ctx: MessageContext): string {
  const commandEntity = ctx.message.entities?.find(
    (item) => item.type === 'bot_command' && item.offset === 0
  )
  return commandEntity
    ? ctx.message.text.substring(commandEntity.length).trim()
    : ctx.message.text.trim()
}
