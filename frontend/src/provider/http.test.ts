import assert from 'node:assert/strict'
import test from 'node:test'
import { httpProvider } from './http.ts'
import { useStore } from '../state/store.ts'

test('chat requests carry the avatar currently shown by the kiosk', async () => {
  const originalFetch = globalThis.fetch
  let request: Record<string, unknown> | undefined

  useStore.setState({ avatarId: 'avatar-blue' })
  globalThis.fetch = async (_input, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>
    return new Response('hello', { status: 200 })
  }

  try {
    const chunks: string[] = []
    for await (const chunk of httpProvider.stream('hello', new AbortController().signal)) {
      chunks.push(chunk)
    }
    assert.deepEqual(chunks, ['hello'])
    assert.equal(request?.avatar_id, 'avatar-blue')
  } finally {
    globalThis.fetch = originalFetch
    useStore.setState({ avatarId: '' })
  }
})
