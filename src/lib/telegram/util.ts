const PLACEHOLDER_PREFIX = '§PLH§'
const PLACEHOLDER_SUFFIX = '§END§'

/**
 * Escape special characters that would be interpreted as Markdown in Telegram.
 * Preserves intentional formatting by protecting it with placeholders first.
 */
export function escapeMarkdown(text: string): string {
  if (!text) return ''

  const placeholders: string[] = []
  let counter = 0

  const save = (match: string): string => {
    const id = counter++
    placeholders[id] = match
    return `${PLACEHOLDER_PREFIX}${id}${PLACEHOLDER_SUFFIX}`
  }

  const restore = (_match: string, id: string): string => {
    return placeholders[parseInt(id, 10)] || ''
  }

  // Step 1: Protect intentional formatting patterns
  let result = text
    .replace(/`[^`]+`/g, save)
    .replace(/\[[^\]]+\]\([^)]+\)/g, save)
    .replace(/\*[^*]+\*/g, save)
    .replace(/_[^_]+_/g, save)

  // Step 2: Escape remaining markdown characters
  result = result
    .replace(/\\/g, '\\\\')
    .replace(/\*/g, '\\*')
    .replace(/_/g, '\\_')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/`/g, '\\`')

  // Step 3: Restore protected patterns
  const restoreRegex = new RegExp(
    `${PLACEHOLDER_PREFIX}([0-9]+)${PLACEHOLDER_SUFFIX}`,
    'g'
  )
  result = result.replace(restoreRegex, restore)

  return result
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

/**
 * Create a Markdown link with proper URL escaping for Telegram.
 * URLs with parentheses or special characters will break standard Markdown link syntax.
 */
export function createMarkdownLink(text: string, url: string): string {
  if (!url) return escapeMarkdown(text)
  const safeUrl = url.replace(/\)/g, '%29')
  return `[${escapeMarkdown(text)}](${safeUrl})`
}
