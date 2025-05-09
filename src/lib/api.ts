import logger from '@lib/logger'
import {
  ImageGenerationParams,
  ImageGenerationResponse,
  ModelList,
  ModelType,
  VeniceResponseError,
} from '@lib/types'
import OpenAI from 'openai'
import { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions/completions'
import { join } from 'node:path'

class VeniceApiError extends Error {
  public details!: string

  constructor(message: string, details?: string) {
    super(message)
    this.details = details ?? ''
  }
}

export async function chatCompletion(
  inputParams: ChatCompletionCreateParamsNonStreaming
): Promise<string | null> {
  const response: OpenAI.Chat.Completions.ChatCompletion = await apiPOST(
    '/chat/completions',
    {
      ...inputParams,
      model: `${inputParams.model}:enable_web_search=auto`,
    }
  )
  const content = response.choices[0].message.content
  return content
}

export async function generateImage(
  params: ImageGenerationParams
): Promise<ImageGenerationResponse> {
  const response = await apiPOST('/image/generate', {
    embed_exif_metadata: false,
    format: 'webp',
    height: 1024,
    hide_watermark: true,
    safe_mode: false,
    ...params,
  })
  return response as ImageGenerationResponse
}

export async function listModels(type?: ModelType): Promise<ModelList> {
  const models = await apiGET('/models', type && `type=${type}`)
  return models as ModelList
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
    const errorMessage = `Error calling Venice API: ${response.statusText}`
    if (response.status >= 500) {
      throw new VeniceApiError(errorMessage)
    }
    const responseJson = (await response.json()) as VeniceResponseError
    const errorDetails = `${responseJson.error}. ${responseJson.details}`.trim()
    const err = new VeniceApiError(errorMessage, errorDetails)
    logger.error({ err })
    throw err
  }

  const responseJson = await response.json()

  logger.debug({ response }, 'Venice API JSON response')

  return responseJson
}
