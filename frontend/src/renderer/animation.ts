import config from './renderer.config.ts'

const rand = (min: number, max: number) => min + Math.random() * (max - min)

/**
 * Idle presence.
 *
 * A looping clip repeats exactly, and the eye catches the seam inside a minute —
 * which is the single fastest way to stop reading as a person. Nudging playback
 * rate makes the loop period non-integer, so the repeat never lands on the
 * viewer's internal beat. The long idle clip does most of the work; this makes
 * what is left much harder to lock onto.
 *
 * ponytail: periodicity-breaking, not randomness. If the loop still reads as a
 * loop on the finished footage, the real fix is a second idle variant crossfaded
 * in at random intervals.
 */
export function startIdlePresence(video: HTMLVideoElement): () => void {
  let timer: number

  const tick = () => {
    video.playbackRate = rand(...config.idleRateJitter)
    timer = window.setTimeout(tick, rand(...config.idleJitterInterval))
  }
  tick()

  return () => {
    window.clearTimeout(timer)
    video.playbackRate = 1
  }
}

/**
 * Warm the cache so the real <video> elements mount without a decode stall.
 *
 * Never rejects. A missing clip must leave her on the poster, not stuck on a
 * loading screen — and during development none of the clips exist yet.
 */
export function preloadClips(urls: string[], timeoutMs = 15000): Promise<void> {
  return Promise.all(urls.map((url) => preload(url, timeoutMs))).then(() => undefined)
}

function preload(url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.src = url

    const done = () => {
      clearTimeout(timer)
      video.removeEventListener('canplaythrough', done)
      video.removeEventListener('error', done)
      video.src = ''
      resolve()
    }
    const timer = setTimeout(done, timeoutMs)

    video.addEventListener('canplaythrough', done, { once: true })
    video.addEventListener('error', done, { once: true })
    video.load()
  })
}

/**
 * Browsers block autoplay until the page has been interacted with. A kiosk that
 * comes up frozen looks broken, so retry rather than assume.
 */
export function keepPlaying(video: HTMLVideoElement): void {
  video.play().catch(() => {
    const retry = () => {
      video.play().catch(() => {})
      document.removeEventListener('pointerdown', retry)
    }
    document.addEventListener('pointerdown', retry, { once: true })
  })
}
