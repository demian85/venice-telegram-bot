const PLACEHOLDER_PREFIX = '\x00PLACEHOLDER_'
const PLACEHOLDER_SUFFIX = '_\x00'

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
  let placeholderCounter = 0

  // Create a unique placeholder that won't appear in normal text
  const createPlaceholder = (): string => {
    const id = placeholderCounter++
    return `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`
  }

  // Protect inline code first (must be before other patterns)
  let protectedText = text.replace(/`([^`]+)`/g, (match) => {
    placeholders.push(match)
    return createPlaceholder()
  })

  // Protect links
  protectedText = protectedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match) => {
    placeholders.push(match)
    return createPlaceholder()
  })

  // Protect bold text
  protectedText = protectedText.replace(/\*([^*]+)\*/g, (match) => {
    placeholders.push(match)
    return createPlaceholder()
  })

  // Protect italic text
  protectedText = protectedText.replace(/_([^_]+)_/g, (match) => {
    placeholders.push(match)
    return createPlaceholder()
  })

  // Now escape any remaining markdown characters in plain text
  protectedText = protectedText
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/`/g, '\\`')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')

  // Restore placeholders
  const placeholderRegex = new RegExp(
    `${PLACEHOLDER_PREFIX}([0-9]+)${PLACEHOLDER_SUFFIX}`,
    'g'
  )
  protectedText = protectedText.replace(placeholderRegex, (_, index) => {
    return placeholders[parseInt(index, 10)] || ''
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
