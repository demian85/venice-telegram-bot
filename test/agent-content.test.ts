import { test, expect, describe } from 'vitest'
import {
  buildPersistedTextShadow,
  buildLiveUserContent,
  extractTextContent,
} from '../src/lib/agent/content.js'

describe('buildPersistedTextShadow', () => {
  test('returns text only when no image', () => {
    const result = buildPersistedTextShadow({ text: 'Hello world' })
    expect(result).toBe('Hello world')
  })

  test('returns empty string when no text and no image', () => {
    const result = buildPersistedTextShadow({})
    expect(result).toBe('')
  })

  test('returns trimmed text', () => {
    const result = buildPersistedTextShadow({ text: '  Hello world  ' })
    expect(result).toBe('Hello world')
  })

  test('returns image placeholder when only image', () => {
    const result = buildPersistedTextShadow({
      imageUrl: 'https://example.com/image.png',
    })
    expect(result).toBe('[image attached]')
  })

  test('returns combined format when both text and image', () => {
    const result = buildPersistedTextShadow({
      text: 'Check this out',
      imageUrl: 'https://example.com/image.png',
    })
    expect(result).toBe('[image attached]\nCaption: Check this out')
  })

  test('handles empty text with image', () => {
    const result = buildPersistedTextShadow({
      text: '',
      imageUrl: 'https://example.com/image.png',
    })
    expect(result).toBe('[image attached]')
  })

  test('handles whitespace-only text with image', () => {
    const result = buildPersistedTextShadow({
      text: '   ',
      imageUrl: 'https://example.com/image.png',
    })
    expect(result).toBe('[image attached]')
  })
})

describe('buildLiveUserContent', () => {
  test('returns text string when no image', () => {
    const result = buildLiveUserContent(
      { text: 'Hello' },
      true // supportsVision
    )
    expect(result).toBe('Hello')
  })

  test('returns text string when vision not supported', () => {
    const result = buildLiveUserContent(
      { text: 'Hello', imageUrl: 'https://example.com/img.png' },
      false // supportsVision = false
    )
    expect(result).toBe('[image attached]\nCaption: Hello')
  })

  test('returns array with image when vision supported', () => {
    const result = buildLiveUserContent(
      { text: 'Hello', imageUrl: 'https://example.com/img.png' },
      true // supportsVision = true
    )

    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
    ])
  })

  test('returns only image when no text and vision supported', () => {
    const result = buildLiveUserContent(
      { imageUrl: 'https://example.com/img.png' },
      true
    )

    expect(Array.isArray(result)).toBe(true)
    expect(result).toEqual([
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
    ])
  })

  test('returns empty string when no content', () => {
    const result = buildLiveUserContent({}, true)
    expect(result).toBe('')
  })

  test('trims text in content array', () => {
    const result = buildLiveUserContent(
      { text: '  Hello world  ', imageUrl: 'https://example.com/img.png' },
      true
    )

    expect(Array.isArray(result)).toBe(true)
    expect((result as Array<{ type: string; text?: string }>)[0]).toEqual({
      type: 'text',
      text: 'Hello world',
    })
  })
})

describe('extractTextContent', () => {
  test('returns string as-is', () => {
    const result = extractTextContent('Hello world')
    expect(result).toBe('Hello world')
  })

  test('extracts text from simple content array', () => {
    const result = extractTextContent([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'world' },
    ])
    expect(result).toBe('Hello\nworld')
  })

  test('extracts text from mixed content array', () => {
    const result = extractTextContent([
      { type: 'text', text: 'Hello' },
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
      { type: 'text', text: 'world' },
    ])
    expect(result).toBe('Hello\nworld')
  })

  test('handles string items in array', () => {
    const result = extractTextContent(['Hello', 'world'])
    expect(result).toBe('Hello\nworld')
  })

  test('trims whitespace from parts', () => {
    const result = extractTextContent([
      { type: 'text', text: '  Hello  ' },
      { type: 'text', text: '  world  ' },
    ])
    expect(result).toBe('Hello\nworld')
  })

  test('filters out empty parts', () => {
    const result = extractTextContent([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: '' },
      { type: 'text', text: 'world' },
    ])
    expect(result).toBe('Hello\nworld')
  })

  test('filters out whitespace-only parts', () => {
    const result = extractTextContent([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: '   ' },
      { type: 'text', text: 'world' },
    ])
    expect(result).toBe('Hello\nworld')
  })

  test('returns JSON for non-text content object', () => {
    const nonTextContent = { some: 'object' }
    const result = extractTextContent(nonTextContent)
    expect(result).toBe('{"some":"object"}')
  })

  test('returns JSON for array with only non-text items', () => {
    const result = extractTextContent([
      { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
    ])
    expect(result).toBe(
      '[{"type":"image_url","image_url":{"url":"https://example.com/img.png"}}]'
    )
  })

  test('handles empty array', () => {
    const result = extractTextContent([])
    expect(result).toBe('[]')
  })

  test('handles null in array gracefully', () => {
    const result = extractTextContent([null, { type: 'text', text: 'Hello' }])
    expect(result).toBe('Hello')
  })

  test('handles undefined in array gracefully', () => {
    const result = extractTextContent([
      undefined,
      { type: 'text', text: 'Hello' },
    ])
    expect(result).toBe('Hello')
  })

  test('handles complex nested content', () => {
    const result = extractTextContent([
      'Plain string',
      { type: 'text', text: 'Text object' },
      { type: 'other', data: 'ignored' },
      { type: 'text', text: 'Another text' },
    ])
    expect(result).toBe('Plain string\nText object\nAnother text')
  })
})
