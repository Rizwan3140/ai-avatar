import assert from 'node:assert/strict'
import test from 'node:test'
import { bus } from '../bus/bus.ts'
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

test('a translated turn is announced, and encoded ids come back whole', async () => {
  // A Telugu "the cheaper one" navigates only once the server's English reading
  // reaches the navigation rules. And a sku holding a comma or Telugu must be
  // fetched as one product, not two fragments.
  const originalFetch = globalThis.fetch
  const heard: string[] = []
  const fetched: string[] = []
  const off = bus.on('USER_UTTERANCE_TRANSLATED', ({ text }) => heard.push(text))

  useStore.setState({ avatarId: 'avatar-blue' })
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.startsWith('/api/products/')) {
      fetched.push(decodeURIComponent(url.slice('/api/products/'.length).split('?')[0]))
      return new Response('null', { status: 404 })
    }
    return new Response('ఇవి చూడండి.', {
      status: 200,
      headers: {
        'X-Heard-As': encodeURIComponent('the cheaper one'),
        'X-Products': `${encodeURIComponent('సారీ,01')},%E0%A4`,
      },
    })
  }

  try {
    for await (const _ of httpProvider.stream('తక్కువ ధరది', new AbortController().signal)) {
      // drain
    }
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(heard, ['the cheaper one'])
    // The malformed second id is dropped rather than failing the turn.
    assert.deepEqual(fetched, ['సారీ,01'])
  } finally {
    off()
    globalThis.fetch = originalFetch
    useStore.setState({ avatarId: '' })
  }
})

test('a turn that matches nothing leaves the shelf alone', async () => {
  // It used to empty it. Every sentence that is not itself a product search —
  // "what is it made of", "how much is that one", "thanks" — arrives with no
  // products, so a visitor asking about the saree in front of them watched it
  // vanish while they were asking. Clearing is deliberate: a spoken "clear" or
  // the Back button, both of which still do it.
  const originalFetch = globalThis.fetch
  const shelf = [{ id: 'p1', name: 'Banarasi Saree' }] as never

  useStore.setState({ avatarId: 'avatar-blue', products: shelf })
  globalThis.fetch = async () =>
    new Response('It is woven silk.', { status: 200, headers: { 'X-Products': '' } })

  try {
    for await (const _ of httpProvider.stream('what is it made of', new AbortController().signal)) {
      // drain
    }
    // The emit is synchronous with the header read, so one tick is enough.
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(useStore.getState().products.length, 1, 'the saree is still on the shelf')
  } finally {
    globalThis.fetch = originalFetch
    useStore.setState({ avatarId: '', products: [] })
  }
})
