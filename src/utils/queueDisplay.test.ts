import { describe, expect, it } from 'vitest'
import { clampDisplayTitle, shortTitleFromUrl } from './queueDisplay'

describe('queueDisplay', () => {
  it('shortTitleFromUrl uses path segment or hostname', () => {
    expect(shortTitleFromUrl('https://example.com/foo/bar.m3u8')).toContain('bar.m3u8')
    expect(shortTitleFromUrl('https://cdn.test/')).toBe('cdn.test')
  })

  it('clampDisplayTitle truncates long strings', () => {
    const long = 'a'.repeat(100)
    expect(clampDisplayTitle(long).length).toBeLessThanOrEqual(81)
  })
})
