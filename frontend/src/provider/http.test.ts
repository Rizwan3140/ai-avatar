import assert from 'node:assert/strict'
import test from 'node:test'
import { bus } from '../bus/bus.ts'
import { httpProvider, openShelf } from './http.ts'
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

test('a department in the reply puts its shelves up as tiles', async () => {
  // "Show me menswear" comes back with no products and X-Shelves: men. The
  // tiles — shelf, count, picture — are fetched for that department.
  const originalFetch = globalThis.fetch
  const asked: string[] = []
  const shown: string[][] = []
  const off = bus.on('SHELVES_SHOWN', ({ shelves }) => shown.push(shelves.map((s) => s.category)))

  useStore.setState({ avatarId: 'avatar-blue' })
  globalThis.fetch = async (input) => {
    const url = String(input)
    asked.push(url)
    if (url.startsWith('/api/products/shelves')) {
      return Response.json({
        department: 'men',
        title: "Men's wear",
        shelves: [
          { category: "Men's Kurtas", count: 15, image: '' },
          { category: 'Pyjamas', count: 2, image: '' },
        ],
      })
    }
    return new Response('Which would you like to see?', {
      status: 200,
      headers: { 'X-Products': '', 'X-Shelves': 'men' },
    })
  }

  try {
    for await (const _ of httpProvider.stream('Show me menswear.', new AbortController().signal)) {
      // drain
    }
    await new Promise((r) => setTimeout(r, 0))
    assert.deepEqual(shown, [["Men's Kurtas", 'Pyjamas']])
    assert.ok(
      asked.includes('/api/products/shelves?department=men&avatar=avatar-blue'),
      asked.join(' | '),
    )
  } finally {
    off()
    globalThis.fetch = originalFetch
    useStore.setState({ avatarId: '', shelves: null })
  }
})

test('a tapped tile asks for its shelf in its department', async () => {
  // Both, or the men's Pants tile opens the women's pants filed beside it.
  const originalFetch = globalThis.fetch
  let asked = ''
  const arrived: { ids: string[]; fromShelf?: boolean }[] = []
  const off = bus.on('PRODUCTS_SHOWN', ({ products, fromShelf }) =>
    arrived.push({ ids: products.map((p) => p.id), fromShelf }),
  )

  useStore.setState({ avatarId: 'avatar-blue' })
  globalThis.fetch = async (input) => {
    asked = String(input)
    return Response.json([{ id: 'm3', name: 'Black Cotton Pant' }])
  }

  try {
    await openShelf('men', "Men's Kurtas")
    const sent = new URLSearchParams(asked.split('?')[1])
    assert.equal(sent.get('department'), 'men')
    assert.equal(sent.get('category'), "Men's Kurtas")
    assert.equal(sent.get('avatar'), 'avatar-blue')
    assert.deepEqual(arrived, [{ ids: ['m3'], fromShelf: true }])
  } finally {
    off()
    globalThis.fetch = originalFetch
    useStore.setState({ avatarId: '', products: [], selected: null })
  }
})

test('a tile is not opened for a cabinet that does not know who it is', async () => {
  // No avatar means no tenant. Asking anyway lets the server pick a default
  // org, which on a two-tenant box is the other company's shelf.
  const originalFetch = globalThis.fetch
  let called = false
  useStore.setState({ avatarId: '' })
  globalThis.fetch = async () => {
    called = true
    return Response.json([])
  }
  try {
    await openShelf('men', 'Pants')
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
