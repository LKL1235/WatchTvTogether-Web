/** 与后端 internal/room 中队列推进逻辑一致（顺序 / 循环） */

import type { PlaybackMode } from '../types'

function indexOfQueue(queue: string[], v: string): number {
  for (let i = 0; i < queue.length; i++) {
    if (queue[i] === v) return i
  }
  return -1
}

/** 当前项自然结束后的下一项（无下一项时返回 null） */
export function nextVideoAfterEnd(current: string, queue: string[], mode: PlaybackMode): string | null {
  if (!queue.length) return null
  const idx = indexOfQueue(queue, current)
  if (idx < 0) return null
  if (mode === 'loop') {
    const next = idx + 1 >= queue.length ? 0 : idx + 1
    return queue[next] ?? null
  }
  if (idx + 1 >= queue.length) return null
  return queue[idx + 1] ?? null
}

/** 用于「下一首」控制：当前不在队列中时回到第一项 */
export function nextInQueueForControl(current: string, queue: string[], mode: PlaybackMode): string | null {
  if (!queue.length) return null
  const idx = indexOfQueue(queue, current)
  if (idx < 0) return queue[0] ?? null
  if (mode === 'loop') {
    const next = idx + 1 >= queue.length ? 0 : idx + 1
    return queue[next] ?? null
  }
  if (idx + 1 >= queue.length) return null
  return queue[idx + 1] ?? null
}
