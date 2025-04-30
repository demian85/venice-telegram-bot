import 'dotenv/config'

import telegramBot from '@lib/telegram'

/////------------------------------------
;(async function init() {
  await telegramBot.launch()
})()
