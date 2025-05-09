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

export function getTextFromCommand(ctx: MessageContext): string {
  const commandEntity = ctx.message.entities?.find(
    (item) => item.type === 'bot_command' && item.offset === 0
  )
  return commandEntity
    ? ctx.message.text.substring(commandEntity.length).trim()
    : ctx.message.text.trim()
}
