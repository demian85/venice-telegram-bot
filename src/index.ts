import 'dotenv/config'

import { Bot } from '@lib/telegram'
import logger from '@lib/logger'
import { Config } from '@lib/types'
import { getRedisClient, closeRedisClient } from '@lib/redis'
import { NewsScheduler } from '@lib/news'
import { createVeniceModel } from '@lib/agent/model'
import { defaultNewsConfig } from '@lib/news/types'

async function loadConfig(): Promise<Config> {
  const defaults = await import('./lib/telegram/defaults')
  try {
    const userConfig = await import('./bot.config')
    return { ...defaults.defaultConfig, ...userConfig.default }
  } catch {
    return defaults.defaultConfig
  }
}

async function main() {
  const config = await loadConfig()
  const redis = getRedisClient()
  const model = createVeniceModel()

  const bot = new Bot(config)
  await bot.init()

  const newsFeeds = process.env.DEFAULT_FEEDS
    ? process.env.DEFAULT_FEEDS.split(',').map((f) => f.trim())
    : defaultNewsConfig.feeds

  const newsScheduler = new NewsScheduler({
    redis,
    model,
    newsConfig: {
      ...defaultNewsConfig,
      feeds: newsFeeds,
      pollIntervalMinutes: parseInt(
        process.env.NEWS_POLL_INTERVAL_MINUTES || '5',
        10
      ),
      relevanceThreshold: parseInt(
        process.env.NEWS_RELEVANCE_THRESHOLD || '70',
        10
      ),
    },
    onRelevantArticle: async (article) => {
      logger.info({ article }, 'Relevant article detected')
    },
  })

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
