import { describe, expect, it } from 'vitest'

import { nextInQueueForControl, nextVideoAfterEnd } from './roomPlayback'

describe('nextVideoAfterEnd', () => {
  it('顺序模式在最后一项无下一项', () => {
    expect(nextVideoAfterEnd('a', ['a', 'b'], 'sequential')).toBe('b')
    expect(nextVideoAfterEnd('b', ['a', 'b'], 'sequential')).toBeNull()
  })

  it('循环模式最后一项回到第一项', () => {
    expect(nextVideoAfterEnd('b', ['a', 'b'], 'loop')).toBe('a')
  })

  it('当前不在队列中时不推进', () => {
    expect(nextVideoAfterEnd('x', ['a', 'b'], 'sequential')).toBeNull()
  })
})

describe('nextInQueueForControl', () => {
  it('当前不在队列时返回首项', () => {
    expect(nextInQueueForControl('x', ['a', 'b'], 'sequential')).toBe('a')
  })
})
