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
