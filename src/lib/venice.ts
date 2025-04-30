import logger from '@lib/logger'
import { OpenAIResponseError } from '@lib/types'
import OpenAI from 'openai'
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions/completions'

const BASE_URL = 'https://api.venice.ai/api/v1'

const openai = new OpenAI({
  apiKey: process.env.VENICE_API_KEY,
  baseURL: BASE_URL,
})

export async function chatCompletion(
  params: ChatCompletionCreateParamsNonStreaming
): Promise<string | null> {
  logger.debug({ params }, 'Sending Venice chat completion request...')

  try {
    const completion = await openai.chat.completions.create({
      ...params,
      // @ts-ignore
      venice_parameters: {
        enable_web_search: 'auto',
      },
    })
    const response = completion.choices[0].message.content

    logger.debug({ response }, 'Venice response')

    return response
  } catch (err) {
    handleError(err as OpenAIResponseError)
    throw err
  }
}

function handleError(error: OpenAIResponseError) {
  if (error.response) {
    const { status, data } = error.response
    logger.error({ status, data })
  } else {
    logger.error({ err: error })
  }
}
