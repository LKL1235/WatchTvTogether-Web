import { describe, expect, it, vi } from 'vitest'

import { waitForVideoReady } from './waitForVideo'

type Entry = { fn: EventListener; once: boolean }

function createFakeVideo(initialReadyState: number) {
  const listeners = new Map<string, Set<Entry>>()
  const video = {
    readyState: initialReadyState,
    addEventListener(type: string, fn: EventListener, opts?: { once?: boolean }) {
      let set = listeners.get(type)
      if (!set) {
        set = new Set()
        listeners.set(type, set)
      }
      set.add({ fn, once: Boolean(opts?.once) })
    },
    removeEventListener(type: string, fn: EventListener) {
      const set = listeners.get(type)
      if (!set) return
      for (const e of set) {
        if (e.fn === fn) set.delete(e)
      }
    },
    dispatch(type: string) {
      const set = listeners.get(type)
      if (!set) return
      for (const e of [...set]) {
        e.fn(new Event(type))
        if (e.once) set.delete(e)
      }
    },
  }
  return video as unknown as HTMLVideoElement & {
    dispatch: (type: string) => void
    readyState: number
  }
}

describe('waitForVideoReady', () => {
  it('若已具备 metadata 则立即 resolve', async () => {
    const video = createFakeVideo(2)
    await expect(waitForVideoReady(video, 100)).resolves.toBeUndefined()
  })

  it('在 loadedmetadata 后 resolve', async () => {
    vi.useFakeTimers()
    const video = createFakeVideo(0)
    const p = waitForVideoReady(video, 5000)
    video.dispatch('loadedmetadata')
    await expect(p).resolves.toBeUndefined()
    vi.useRealTimers()
  })
})
