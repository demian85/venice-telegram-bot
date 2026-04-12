const PLACEHOLDER_PREFIX = '«PLACEHOLDER_'
const PLACEHOLDER_SUFFIX = '_PLACEHOLDER»'

/**
 * Escape special characters that would be interpreted as Markdown in Telegram.
 * Only escapes characters that are NOT part of intentional formatting.
 *
 * Telegram Markdown (legacy) supports:
 * - *bold text*
 * - _italic text_
 * - `inline fixed-width code`
 * - ```pre-formatted fixed-width code block```
 * - [text](URL)
 *
 * This function escapes markdown characters in plain text content to prevent
 * accidental formatting while preserving intentional markdown syntax.
 */
export function escapeMarkdown(text: string): string {
  if (!text) return ''

  const placeholders: string[] = []

  let protectedText = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match) => {
    placeholders.push(match)
    return `${PLACEHOLDER_PREFIX}${placeholders.length - 1}${PLACEHOLDER_SUFFIX}`
  })

  protectedText = protectedText.replace(/\*([^*]+)\*/g, (match) => {
    placeholders.push(match)
    return `${PLACEHOLDER_PREFIX}${placeholders.length - 1}${PLACEHOLDER_SUFFIX}`
  })

  protectedText = protectedText.replace(/_([^_]+)_/g, (match) => {
    placeholders.push(match)
    return `${PLACEHOLDER_PREFIX}${placeholders.length - 1}${PLACEHOLDER_SUFFIX}`
  })

  protectedText = protectedText.replace(/`([^`]+)`/g, (match) => {
    placeholders.push(match)
    return `${PLACEHOLDER_PREFIX}${placeholders.length - 1}${PLACEHOLDER_SUFFIX}`
  })

  protectedText = protectedText
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')

  const placeholderRegex = new RegExp(
    `${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`,
    'g'
  )
  protectedText = protectedText.replace(placeholderRegex, (_, index) => {
    return placeholders[parseInt(index)]
  })

  return protectedText
}

/**
 * Convert standard Markdown to Telegram-compatible Markdown.
 *
 * Handles:
 * - Headers (# ## ###) → Bold text
 * - Horizontal rules (---) → Dashes
 * - Preserves existing Telegram markdown
 */
export function fullMarkdown2TgMarkdown(input: string): string {
  if (!input) return ''

  return (
    input
      // Convert headers (# text) to bold (*text*)
      .replace(/^#+ *(.+)$/gm, '*$1*')
      // Convert horizontal rules to visual separator
      .replace(/^---+$/gm, '───────────────')
      // Clean up excessive newlines
      .replace(/\n{4,}/g, '\n\n\n')
  )
}

/**
 * Format a reply for Telegram by converting markdown and escaping problematic characters.
 * This is the main entry point for formatting agent/tool responses.
 */
export function formatTelegramMarkdownReply(input: string): string {
  if (!input) return ''

  // First convert standard markdown to Telegram format
  const converted = fullMarkdown2TgMarkdown(input)

  // Then escape any problematic characters while preserving intentional formatting
  return escapeMarkdown(converted).trim()
}
