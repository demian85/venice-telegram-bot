import pgp, { IMain } from 'pg-promise'

import logger from './logger'

let instance: ReturnType<IMain> | null = null

export interface QueryResultError extends Error {
  code: string
}

export const Database = pgp({
  capSQL: true,
  error: (err, _ctx) => {
    logger.error({ err }, 'Database error')
  },
})

export const db = () => {
  if (!instance) {
    instance = Database({
      host: process.env.PG_HOST,
      database: process.env.PG_DB,
      user: process.env.PG_USER,
      password: process.env.PG_PASSWORD,
      max: 3,
      idleTimeoutMillis: 10000,
      // connect_timeout: 5,
    })
  }
  return instance
}

export const close = () => {
  if (instance) {
    instance.$pool.end()
    instance = null
  }
}
