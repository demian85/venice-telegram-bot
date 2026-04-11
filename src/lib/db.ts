import logger from './logger'

export const db = () => {
  logger.warn('PostgreSQL support has been removed. Using Redis instead.')
  return {
    query: async () => [],
    none: async () => {},
    one: async () => null,
    many: async () => [],
  }
}

export const Database = {
  $pool: {
    end: async () => {},
  },
}

export const close = () => {
  logger.info('Database connection closed (Redis is now used instead)')
}

export interface QueryResultError extends Error {
  code: string
}
