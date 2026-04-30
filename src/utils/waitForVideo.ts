/** 等待 video 元素可安全设置 currentTime（避免在 metadata 前应用进度无效） */
export function waitForVideoReady(video: HTMLVideoElement, timeoutMs = 8000): Promise<void> {
  if (video.readyState >= 1) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const onLoaded = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('视频加载失败'))
    }
    const timer = globalThis.setTimeout(() => {
      cleanup()
      resolve()
    }, timeoutMs)
    function cleanup() {
      clearTimeout(timer)
      video.removeEventListener('loadedmetadata', onLoaded)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadedmetadata', onLoaded, { once: true })
    video.addEventListener('error', onError, { once: true })
  })
}
