import 'dotenv/config'

import { Bot } from '@lib/telegram'
import logger from '@lib/logger'
import { Config } from '@lib/types'

async function loadConfig(): Promise<Config> {
  const defaults = await import('./lib/telegram/defaults')
  try {
    const userConfig = await import('./bot.config')
    return { ...defaults.defaultConfig, ...userConfig.default }
  } catch (err) {
    return defaults.defaultConfig
  }
}

loadConfig()
  .then((config) => {
    const bot = new Bot(config)
    return bot.init()
  })
  .catch((err) => {
    logger.error(err)
  })
