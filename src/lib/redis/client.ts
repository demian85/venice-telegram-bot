import { Redis } from 'ioredis'

let redisClient: Redis | null = null

export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
    redisClient = new Redis(redisUrl)

    redisClient.on('error', (err: Error) => {
      console.error('Redis error:', err)
    })

    redisClient.on('connect', () => {
      console.log('Redis connected')
    })
  }

  return redisClient
}

export function closeRedisClient(): void {
  if (redisClient) {
    redisClient.disconnect()
    redisClient = null
  }
}
