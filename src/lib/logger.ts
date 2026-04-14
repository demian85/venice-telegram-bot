import { pino } from 'pino'

const loggerOptions = {
  name: 'venice-assistant-bot',
  level: process.env.LOG_LEVEL || 'info',
  serializers: {
    err: pino.stdSerializers.err,
  },
  base: null,
}

export default pino(loggerOptions, pino.destination(1))
