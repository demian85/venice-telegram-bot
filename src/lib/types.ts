export interface OpenAIResponseError {
  message: string
  response?: {
    status: string
    data: unknown
  }
}
