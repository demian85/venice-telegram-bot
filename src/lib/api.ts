import logger from '@lib/logger'
import {
  ImageGenerationParams,
  ImageGenerationResponse,
  ModelList,
  ModelType,
  OpenAIResponseError,
} from '@lib/types'
import OpenAI from 'openai'
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions/completions'
import { join } from 'node:path'

const BASE_URL = 'https://api.venice.ai/api/v1'

const openai = new OpenAI({
  apiKey: process.env.VENICE_API_KEY,
  baseURL: BASE_URL,
})

export async function chatCompletion(
  inputParams: ChatCompletionCreateParamsNonStreaming
): Promise<string | null> {
  const params = {
    ...inputParams,
    model: `${inputParams.model}:enable_web_search=auto`,
  }

  logger.debug({ params }, 'Sending Venice chat completion request...')

  try {
    const completion = await openai.chat.completions.create(params)
    const response = completion.choices[0].message.content

    logger.debug({ response }, 'Venice response')

    return response
  } catch (err) {
    handleError(err as OpenAIResponseError)
    throw err
  }
}

export async function generateImage(
  params: ImageGenerationParams
): Promise<ImageGenerationResponse> {
  try {
    const response = await apiPOST('/image/generate', {
      embed_exif_metadata: false,
      format: 'webp',
      height: 1024,
      hide_watermark: true,
      safe_mode: false,
      ...params,
    })
    return response as ImageGenerationResponse
  } catch (err) {
    handleError(err as OpenAIResponseError)
    throw err
  }
}

export async function listModels(type?: ModelType): Promise<ModelList> {
  try {
    const models = await apiGET('/models', type && `type=${type}`)
    return models as ModelList
  } catch (err) {
    handleError(err as OpenAIResponseError)
    throw err
  }
}

async function apiGET(path: string, qs?: string) {
  return apiCall(path, 'GET', undefined, qs)
}

async function apiPOST(path: string, body: unknown, qs?: string) {
  return apiCall(path, 'POST', JSON.stringify(body), qs)
}

async function apiCall(
  path: string,
  method = 'GET',
  body?: BodyInit,
  qs?: string
) {
  const url = new URL(join('/api/v1', path), 'https://api.venice.ai')
  if (qs) {
    url.search = new URLSearchParams(qs).toString()
  }

  logger.debug({ url, method, body }, 'Calling Venice API...')

  const response = await fetch(url, {
    method,
    body,
    headers: {
      Authorization: `Bearer ${process.env.VENICE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    redirect: 'follow',
  })

  if (!response.ok) {
    throw new Error(`Error fetching from Venice API: ${response.statusText}`)
  }

  const responseJson = await response.json()

  logger.debug({ response }, 'Venice API JSON response')

  return responseJson
}

function handleError(error: OpenAIResponseError) {
  if (error.response) {
    const { status, data } = error.response
    logger.error({ status, data })
  } else {
    logger.error({ err: error })
  }
}
