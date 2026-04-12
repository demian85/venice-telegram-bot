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

export function fullMarkdown2TgMarkdown(input: string): string {
  return input
    .replaceAll(/^#+ *(.+)$/gm, '*$1*\n')
    .replaceAll(/^--- *$/gm, '---------------')
}

export function formatTelegramMarkdownReply(input: string): string {
  return fullMarkdown2TgMarkdown(input).trim()
}
