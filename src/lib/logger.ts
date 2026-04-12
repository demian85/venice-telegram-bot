import { pino } from 'pino'

const loggerOptions = {
  name: 'venice-assistant-bot',
  level: process.env.LOG_LEVEL || 'info',
  serializers: {
    err: pino.stdSerializers.err,
  },
  base: null,
}

export default pino(
  loggerOptions,
  process.env.NODE_ENV !== 'test'
    ? pino.destination(1)
    : pino.destination('./log')
)
