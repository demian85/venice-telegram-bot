import { test, expect, describe } from 'vitest'
import {
  getNormalizedChatType,
  getChatScopeKey,
  getContextChatScope,
  type TelegramChatScopeType,
} from '../src/lib/telegram/scope.js'

describe('getNormalizedChatType', () => {
  test('returns private for private chat type', () => {
    expect(getNormalizedChatType('private')).toBe('private')
  })

  test('returns group for group chat type', () => {
    expect(getNormalizedChatType('group')).toBe('group')
  })

  test('returns group for supergroup chat type', () => {
    expect(getNormalizedChatType('supergroup')).toBe('group')
  })

  test('returns null for channel', () => {
    expect(getNormalizedChatType('channel')).toBeNull()
  })

  test('returns null for unknown type', () => {
    expect(getNormalizedChatType('unknown')).toBeNull()
  })

  test('returns null for undefined', () => {
    expect(getNormalizedChatType(undefined)).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(getNormalizedChatType('')).toBeNull()
  })
})

describe('getChatScopeKey', () => {
  test('creates correct key for private chat', () => {
    expect(getChatScopeKey('private', 123)).toBe('private:123')
  })

  test('creates correct key for group chat', () => {
    expect(getChatScopeKey('group', -1001234567890)).toBe(
      'group:-1001234567890'
    )
  })

  test('handles string chat ID', () => {
    expect(getChatScopeKey('private', 'user123')).toBe('private:user123')
  })

  test('handles negative group IDs', () => {
    expect(getChatScopeKey('group', -456)).toBe('group:-456')
  })
})

describe('getContextChatScope', () => {
  test('returns scope for private chat context', () => {
    const ctx = {
      chat: {
        id: 123456,
        type: 'private' as const,
      },
    }

    const result = getContextChatScope(ctx as never)

    expect(result).toEqual({
      chatType: 'private' as TelegramChatScopeType,
      chatScope: 'private:123456',
    })
  })

  test('returns scope for group chat context', () => {
    const ctx = {
      chat: {
        id: -1001234567890,
        type: 'group' as const,
      },
    }

    const result = getContextChatScope(ctx as never)

    expect(result).toEqual({
      chatType: 'group' as TelegramChatScopeType,
      chatScope: 'group:-1001234567890',
    })
  })

  test('returns scope for supergroup chat context', () => {
    const ctx = {
      chat: {
        id: -1009876543210,
        type: 'supergroup' as const,
      },
    }

    const result = getContextChatScope(ctx as never)

    expect(result).toEqual({
      chatType: 'group' as TelegramChatScopeType,
      chatScope: 'group:-1009876543210',
    })
  })

  test('returns null when chat is undefined', () => {
    const ctx = {}

    const result = getContextChatScope(ctx as never)

    expect(result).toBeNull()
  })

  test('returns null when chat type is unsupported', () => {
    const ctx = {
      chat: {
        id: 123,
        type: 'channel' as const,
      },
    }

    const result = getContextChatScope(ctx as never)

    expect(result).toBeNull()
  })

  test('returns null when chat ID is undefined', () => {
    const ctx = {
      chat: {
        type: 'private' as const,
      },
    }

    const result = getContextChatScope(ctx as never)

    expect(result).toBeNull()
  })

  test('returns null when both chat and chat type are missing', () => {
    const ctx = {
      chat: {},
    }

    const result = getContextChatScope(ctx as never)

    expect(result).toBeNull()
  })
})
