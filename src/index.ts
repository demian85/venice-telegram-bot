import 'dotenv/config'

import { Bot } from '@lib/telegram'
import logger from '@lib/logger'
import { loadAppConfig } from '@lib/config/load-config'
import type { AppConfig } from '@lib/config/types'
import { getRedisClient, closeRedisClient } from '@lib/redis'
import { NewsScheduler, NewsStore, NewsQueryService } from '@lib/news'
import { createAgentTools } from '@lib/agent/tools'
import { createLlmRoleModels, llmSupportsVision } from '@lib/llm/model'

async function main() {
  const config: AppConfig = loadAppConfig()
  const redis = getRedisClient()

  const models = createLlmRoleModels(config)

  const newsStore = new NewsStore(redis)
  const newsQueryService = new NewsQueryService({
    redis,
    relevanceThreshold: config.news.relevanceThreshold,
  })

  const bot = new Bot(
    { telegram: config.telegram },
    {
      agentModel: models.chat,
      summarizerModel: models.summarizer,
      chatSystemPrompt: config.llm.roles.chat.systemPrompt,
      supportsVision: llmSupportsVision('chat', config),
    },
    {
      redis,
      newsQueryService,
    }
  )

  const _tools = createAgentTools({ newsQueryService })

  await bot.init()

  const newsScheduler = new NewsScheduler(
    {
      redis,
      model: models.newsRelevance,
      newsConfig: config.news,
      onDeliverArticle: async ({ chatId, article }) => {
        await bot.sendNewsArticle(chatId, article)
        logger.info({ chatId, article }, 'Relevant article delivered')
      },
    },
    {
      newsStore,
    }
  )

  await newsScheduler.start()
  logger.info('News scheduler started')

  process.once('SIGINT', async () => {
    logger.info('Shutting down...')
    await newsScheduler.stop()
    closeRedisClient()
    process.exit(0)
  })

  process.once('SIGTERM', async () => {
    logger.info('Shutting down...')
    await newsScheduler.stop()
    closeRedisClient()
    process.exit(0)
  })
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
