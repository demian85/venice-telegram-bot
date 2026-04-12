import { tool } from '@langchain/core/tools'
import { z } from 'zod'
import type { StructuredTool } from '@langchain/core/tools'

function safeEvaluate(expression: string): number {
  const sanitized = expression.replace(/[^0-9+\-*/.()\s]/g, '')
  if (!sanitized) {
    throw new Error('Invalid expression')
  }

  const result = Function(`"use strict"; return (${sanitized})`)()

  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('Invalid result')
  }

  return result
}

export const calculatorTool = tool(
  async ({ expression }) => {
    try {
      const result = safeEvaluate(expression)
      return result.toString()
    } catch {
      return `Error: Invalid expression. Only basic math operations (+, -, *, /, parentheses) are supported.`
    }
  },
  {
    name: 'calculator',
    description:
      'Evaluate mathematical expressions safely. Supports +, -, *, /, and parentheses.',
    schema: z.object({
      expression: z
        .string()
        .describe(
          'The mathematical expression to evaluate, e.g., "2 + 2" or "(10 * 5) / 2"'
        ),
    }),
  }
)

export const helpTool = tool(
  async ({ topic }) => {
    const generalHelp = `
I am a Venice AI-powered Telegram bot. Here's what I can do:

**General Chat:**
- Talk to me in private chats, or mention me in groups to get a reply
- I remember our conversation context
- I can use tools to help you

**Available Commands:**
- /help - Show this help message
- /clear - Clear conversation history
- /info - Show chat and subscription status
- /subscribe - Enable AI news delivery for this chat
- /unsubscribe - Disable AI news delivery for this chat
- /interval [seconds] - Show or set the news delivery interval

**Tools:**
- Calculator: Ask me to calculate expressions
- Current Time: Ask for the current time

**News Monitoring:**
I monitor AI news feeds and forward relevant articles to groups.
`

    const calculatorHelp = `
**Calculator Tool:**
I can evaluate mathematical expressions for you.

Examples:
- "What is 15 * 24?"
- "Calculate (100 + 50) / 3"
- "What's 2^10?"

Supported operations: +, -, *, /, parentheses
`

    const timeHelp = `
**Time Tool:**
I can tell you the current date and time.

Examples:
- "What time is it?"
- "What's the current date?"
- "Give me a timestamp"
`

    const topicLower = topic?.toLowerCase() || ''

    if (topicLower.includes('calculator') || topicLower.includes('math')) {
      return calculatorHelp
    }
    if (topicLower.includes('time') || topicLower.includes('date')) {
      return timeHelp
    }

    return generalHelp
  },
  {
    name: 'help',
    description:
      'Get help about bot capabilities and commands. Optionally specify a topic like "calculator" or "time".',
    schema: z.object({
      topic: z
        .string()
        .optional()
        .describe(
          'Optional topic to get specific help about (e.g., "calculator", "time")'
        ),
    }),
  }
)

export const timeTool = tool(
  async ({ timezone }) => {
    const now = new Date()

    if (timezone && timezone !== 'UTC') {
      try {
        const options: Intl.DateTimeFormatOptions = {
          timeZone: timezone,
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          timeZoneName: 'short',
        }
        return new Intl.DateTimeFormat('en-US', options).format(now)
      } catch {
        return `Error: Invalid timezone "${timezone}". Using UTC instead: ${now.toISOString()}`
      }
    }

    return now.toISOString()
  },
  {
    name: 'current_time',
    description:
      'Get the current date and time. Optionally specify a timezone (default is UTC).',
    schema: z.object({
      timezone: z
        .string()
        .optional()
        .describe(
          'Timezone (e.g., "America/New_York", "Europe/London"). Defaults to UTC.'
        ),
    }),
  }
)

export const allTools: StructuredTool[] = [calculatorTool, helpTool, timeTool]
