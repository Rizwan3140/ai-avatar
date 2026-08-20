import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visiblePose } from './renderer.avatar.ts'
import type { Pose } from './renderer.types.ts'

const none: ReadonlySet<Pose> = new Set()

test('a pose with footage plays its own clip', () => {
  const clips = { idle: '/idle.mp4', speak: '/speak.mp4' }
  assert.equal(visiblePose(clips, 'speak', none), 'speak')
})

test('a pose that was never filmed falls back to idle', () => {
  // The bug this guards: only `missing` was checked, and a clip that does not
  // exist never errors — the element simply gets no src. He froze the moment
  // anyone spoke to him, showing an empty video over a hidden idle clip.
  const clips = { idle: '/idle.mp4' }
  assert.equal(visiblePose(clips, 'speak', none), 'idle')
  assert.equal(visiblePose(clips, 'think', none), 'idle')
  assert.equal(visiblePose(clips, 'listen', none), 'idle')
})

test('a pose whose clip failed to load falls back too', () => {
  const clips = { idle: '/idle.mp4', speak: '/broken.mp4' }
  assert.equal(visiblePose(clips, 'speak', new Set<Pose>(['speak'])), 'idle')
})

test('idle with no footage at all still resolves to idle', () => {
  // Nothing to show either way — but it must not return a pose the caller
  // cannot render, or the poster never gets its chance.
  assert.equal(visiblePose({}, 'idle', none), 'idle')
  assert.equal(visiblePose({}, 'speak', none), 'idle')
})
