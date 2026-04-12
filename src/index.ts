import 'dotenv/config'

import { Bot } from '@lib/telegram'
import logger from '@lib/logger'
import { loadAppConfig } from '@lib/config/load-config'
import type { AppConfig } from '@lib/config/types'
import { getRedisClient, closeRedisClient } from '@lib/redis'
import { NewsScheduler } from '@lib/news'
import { createLlmRoleModels, llmSupportsVision } from '@lib/llm/model'

async function main() {
  const config: AppConfig = loadAppConfig()
  const redis = getRedisClient()

  const models = createLlmRoleModels(config)

  const bot = new Bot(
    { telegram: config.telegram },
    {
      agentModel: models.chat,
      summarizerModel: models.summarizer,
      chatSystemPrompt: config.llm.roles.chat.systemPrompt,
      supportsVision: llmSupportsVision('chat', config),
    }
  )
  await bot.init()

  const newsScheduler = new NewsScheduler({
    redis,
    model: models.newsRelevance,
    newsConfig: config.news,
    onDeliverArticle: async ({ chatId, article }) => {
      await bot.sendNewsArticle(chatId, article)
      logger.info({ chatId, article }, 'Relevant article delivered')
    },
  })

  // NOTE: Set LOG_LEVEL=debug to see news.scheduler.start and news.job.* events.
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
