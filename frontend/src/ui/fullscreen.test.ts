import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillScreen, fillScreenOnTouch } from './fullscreen.ts'

test('a tap asks for fullscreen once, and again only after it was left', async () => {
  let asked = 0
  const screen = {
    fullscreenElement: null as Element | null,
    documentElement: { requestFullscreen: async () => void asked++ },
  }
  fillScreen(screen)
  assert.equal(asked, 1)
  screen.fullscreenElement = {} as Element
  fillScreen(screen)
  assert.equal(asked, 1, 'already fullscreen: not asked again')
  screen.fullscreenElement = null
  fillScreen(screen)
  assert.equal(asked, 2, 'left fullscreen: asked again')
  // A refusal is not an error anybody sees, and a browser without it is fine.
  fillScreen({ fullscreenElement: null, documentElement: { requestFullscreen: () => Promise.reject(new Error('no')) } })
  fillScreen({ fullscreenElement: null, documentElement: {} })
})

test('released taps and key presses are listened for', () => {
  const heard: string[] = []
  fillScreenOnTouch({ addEventListener: (type: string) => void heard.push(type) } as unknown as EventTarget)
  assert.deepEqual(heard, ['pointerup', 'keydown'])
})
