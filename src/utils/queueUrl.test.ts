import { describe, expect, it } from 'vitest'
import { isPlaybackUrl } from './queueUrl'

describe('isPlaybackUrl', () => {
  it('accepts http(s) and protocol-relative URLs', () => {
    expect(isPlaybackUrl('https://a.test/v.mp4')).toBe(true)
    expect(isPlaybackUrl('//cdn.test/x.m3u8')).toBe(true)
  })
  it('rejects catalog ids', () => {
    expect(isPlaybackUrl('video-1')).toBe(false)
  })
})
