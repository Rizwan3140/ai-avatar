import { test } from 'node:test'
import assert from 'node:assert/strict'
import { VIEWS, pathForView, viewFromPath } from './routes.ts'

/**
 * The property that matters: a tab's URL reopens that tab. Everything else here
 * is about the addresses people actually type, which are rarely the canonical
 * ones.
 */

test('every tab survives a round trip through its own URL', () => {
  for (const view of VIEWS) {
    assert.equal(viewFromPath(pathForView(view)), view, view)
  }
})

test('home is the bare address, not a synonym for it', () => {
  assert.equal(pathForView('home'), '/studio')
  assert.equal(viewFromPath('/studio'), 'home')
  // The backend redirects a fresh install to `/studio`, and a browser is free
  // to leave a trailing slash behind after a redirect.
  assert.equal(viewFromPath('/studio/'), 'home')
})

test('the spellings a person types', () => {
  assert.equal(viewFromPath('/studio/avatars/'), 'avatars')
  assert.equal(viewFromPath('/studio/Avatars'), 'avatars')
  assert.equal(viewFromPath('/studio//insights'), 'insights')
})

test('an unknown tab lands on home rather than nothing', () => {
  // A typo should not render a blank page that reads as a broken studio.
  assert.equal(viewFromPath('/studio/avatr'), 'home')
  assert.equal(viewFromPath('/studio/products/extra'), 'home')
  assert.equal(viewFromPath('/'), 'home')
})

test('no tab claims a path the cabinet already owns', () => {
  // `/avatars` is the media mount serving footage, and `/` is the cabinet
  // itself. A tab at either would shadow something a visitor sees.
  for (const view of VIEWS) {
    const path = pathForView(view)
    assert.ok(path.startsWith('/studio'), `${view} escaped /studio: ${path}`)
    assert.notEqual(path, '/avatars')
  }
})
