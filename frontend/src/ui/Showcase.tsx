import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react'
import { bus } from '../bus/bus.ts'
import type { Product, Shelf, Shelves } from '../bus/events.ts'
import { openShelf, scope, showShelves } from '../provider/http.ts'
import { useStore } from '../state/store.ts'
import { Controls } from './Controls.tsx'
import { TryOn } from './TryOn.tsx'

/**
 * Products, when asked for.
 *
 * Nothing appears until a visitor asks — they are the experience, and a grid of
 * cards on arrival would make this a website with a face on it. When products do
 * appear they do not leave; they move aside and keeps talking, so the visitor is
 * still being helped by someone rather than browsing alone.
 */
export function Showcase() {
  const { products, selected, shelves } = useStore()
  if (!products.length && !shelves) return null

  return (
    // A shelf floating over them, not one that pushes them up to make room.
    // Translucent and blurred rather than the opaque `bg-canvas` this used to
    // be — the whole point is that they are still visible behind it, full
    // height, while what they are showing sits over the lower part of them.
    // The shelf of results is its own floating panel, so here the band is
    // transparent and only keeps it off the edges; one product keeps the band.
    <aside
      // Eye level, not the floor, for the list and for one product alike:
      // centred on the panel so a visitor at a tall cabinet looks straight at
      // the pieces, --shelf-offset nudging it below centre. Opening a product
      // swaps the panel in place instead of dropping a band over the person.
      // Landscape has width to spare either side of them, so there it sits
      // beside them instead of across them.
      className="lay-down pointer-events-none absolute inset-0 z-10 flex flex-col justify-center px-[clamp(28px,3vh,110px)] pt-(--shelf-offset) [&>*]:pointer-events-auto landscape:left-[64%] landscape:pl-0 landscape:pt-0"
    >
      {/* The card and, riding on its top-right corner, the mic and stop
          buttons. `relative` is what they anchor to, so they follow the card
          whether it is the slim list or the taller single product. */}
      <div className="relative">
        <Controls above />
        {/* One product, a list of them, or — with neither — a department's
            shelves to choose from. `shelves` is still set behind a tapped
            tile's products, which is what their Back returns to. */}
        {selected ? (
          <Detail product={selected} siblings={products.length} from={shelves} />
        ) : products.length ? (
          <Rail products={products} from={shelves} />
        ) : (
          shelves && <Tiles shelves={shelves} />
        )}
      </div>
    </aside>
  )
}

/**
 * What these products have in common, if anything.
 *
 * Worth showing only now that it is true. Until the catalog started filtering on
 * a named category, "show me kurta sets" returned a co-ord, a dupatta and a
 * dress — so a heading saying "Kurta Sets" would have been a caption lying about
 * the pictures underneath it. A shelf that is one shelf can be named.
 */
function sharedCategory(products: Product[]): string {
  const first = products[0]?.category?.trim()
  if (!first) return ''
  return products.every((p) => p.category?.trim() === first) ? first : ''
}

/**
 * Lets a mouse — or a touch panel that reaches the browser as one — move the row.
 *
 * With its scrollbar hidden, the shelf scrolled only for a real finger or a
 * trackpad. macOS has no touchscreen support, so a cabinet's touch overlay
 * arrives as a mouse, and a mouse can neither drag an overflow box nor turn a
 * vertical wheel into sideways movement: the shelf showed four of eight results
 * and would not move. Touch keeps the browser's own swipe; every other pointer
 * drags, and a vertical wheel steps sideways.
 */
function useSideScroll(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const row = ref.current
    if (!row) return
    let start: { x: number; left: number } | null = null
    let dragged = false

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return
      start = { x: e.clientX, left: row.scrollLeft }
      dragged = false
    }
    const move = (e: PointerEvent) => {
      if (!start) return
      const dx = e.clientX - start.x
      if (!dragged && Math.abs(dx) < 8) return // a shaky tap is still a tap
      if (!dragged) {
        dragged = true
        row.style.scrollSnapType = 'none' // snapping mid-drag fights the hand
      }
      row.scrollLeft = start.left - dx
    }
    const up = () => {
      if (!start) return
      start = null
      row.style.scrollSnapType = '' // back to the class, which settles on a garment
    }
    // A drag ends with a click on whichever card it began over. That is not a choice.
    const click = (e: MouseEvent) => {
      if (!dragged) return
      e.stopPropagation()
      e.preventDefault()
      dragged = false
    }
    // Scrolling by, not to: Chrome snaps a scrollBy to the next garment in its
    // direction, where a small scrollLeft change would snap straight back.
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
      e.preventDefault()
      row.scrollBy({ left: e.deltaY })
    }
    // A picture dragged by mouse becomes a browser drag-and-drop and swallows the
    // moves above. Only on the row: the detail view's photos stay draggable.
    const noNativeDrag = (e: DragEvent) => e.preventDefault()

    row.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    row.addEventListener('click', click, true)
    row.addEventListener('wheel', wheel, { passive: false })
    row.addEventListener('dragstart', noNativeDrag)
    return () => {
      row.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      row.removeEventListener('click', click, true)
      row.removeEventListener('wheel', wheel)
      row.removeEventListener('dragstart', noNativeDrag)
    }
  }, [ref])
}

/** "Dhiyona FL Women's Pink Top" without the brand every name on the panel
 *  starts with — a card has room for about four words. A name that does not
 *  start with its brand is shown whole: this used to fall back to the category,
 *  so another vendor's shirts were all labelled "Shirts". */
function shortName(product: Product): string {
  const brand = String(product.attributes?.brand ?? '').trim()
  const rest = brand && product.name.startsWith(brand) ? product.name.slice(brand.length).trim() : ''
  return rest || product.name
}

/**
 * The floating strip itself: a heading, one scrolling row of cards, and dots
 * for where in the row the visitor is.
 *
 * Shared by the product list and the category tiles on purpose. A visitor
 * choosing a category and then a piece from it is doing one thing, and two
 * panels that scrolled or sat differently would make it feel like two.
 */
function Strip({
  title,
  tally,
  back,
  watch,
  children,
}: {
  title: string
  tally: string
  back?: Back
  /** Whatever the row is showing. The dots are re-measured when it changes. */
  watch: unknown
  children: ReactNode
}) {
  const row = useRef<HTMLDivElement>(null)
  const [pages, setPages] = useState({ count: 1, at: 0 })
  useSideScroll(row)

  // Where in the row they are, as dots: "there is more" without a button, and
  // without anything opening over the person the way "See all" did.
  useEffect(() => {
    const el = row.current
    if (!el) return
    const measure = () =>
      setPages({
        count: Math.max(1, Math.round(el.scrollWidth / el.clientWidth)),
        at: Math.round(el.scrollLeft / el.clientWidth),
      })
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [watch])

  return (
    // A slim strip at eye level. Tall enough to judge a garment by, short enough
    // that their face and shoulders stay clear above it — they are the product
    // and this is what they are showing, not a panel that replaces them.
    // Portrait (the cabinet): four across. Landscape: it sits beside them, two
    // across.
    <div className="lay-down bg-canvas/70 border-line/60 shadow-float flex flex-col gap-[clamp(8px,0.9vh,32px)] rounded-[clamp(16px,1.8vh,60px)] border p-[clamp(10px,1.2vh,44px)] backdrop-blur-xl">
      <Heading title={title} tally={tally} back={back} />

      <div
        ref={row}
        // No copying from the list: the pictures are the shop's. The detail view
        // is where a garment may be dragged, which Anywear needs.
        onContextMenu={(e) => e.preventDefault()}
        className="flex snap-x snap-mandatory gap-[clamp(8px,0.9vh,32px)] overflow-x-auto select-none [scrollbar-width:none]"
      >
        {children}
      </div>

      {pages.count > 1 && (
        <div aria-hidden className="flex justify-center gap-[0.4em]">
          {Array.from({ length: pages.count }, (_, i) => (
            <span
              key={i}
              className={`h-[0.35em] rounded-full transition-all duration-300 ${
                i === pages.at ? 'bg-ink w-[1.2em]' : 'bg-line w-[0.35em]'
              }`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** One card in a strip: four across on the cabinet, two beside them in
 *  landscape. A product and a category tile are the same card with different
 *  words under the picture. */
const CARD =
  'lay-down border-line/60 bg-canvas group flex w-[calc((100%-3*clamp(8px,0.9vh,32px))/4)] shrink-0 snap-start flex-col overflow-hidden rounded-[clamp(10px,1.1vh,36px)] border text-left shadow-sm transition-[box-shadow,transform] duration-300 ease-(--ease-human) hover:shadow-float active:scale-[0.98] landscape:w-[calc((100%-clamp(8px,0.9vh,32px))/2)]'

/** Laid out one after another rather than all at once. Capped at eight steps
 *  so a longer list never turns the wait into a queue — past that they arrive
 *  together, which nobody reads as a fault. */
const arriving = (i: number) => ({ animationDelay: `${Math.min(i, 8) * 55}ms` })

/** "Men's Kurtas" under a heading that already says Men's wear is "Kurtas". */
const withoutWhose = (text: string) => text.replace(/^(wo)?men['’]s\s+/i, '')

function Rail({ products, from }: { products: Product[]; from: Shelves | null }) {
  const shelf = sharedCategory(products)
  const count = products.length

  return (
    <Strip
      title={shelf || 'Selected for you'}
      tally={`${count} ${count === 1 ? 'piece' : 'pieces'}`}
      // Reached from a tile, the way back is to the tiles.
      back={from ? { label: from.title, to: () => bus.emit('SHELF_CLOSED') } : undefined}
      watch={products}
    >
      {products.map((product, i) => {
        return (
          <button
            key={product.id}
            type="button"
            onClick={() => bus.emit('PRODUCT_SELECTED', { product })}
            className={CARD}
            style={arriving(i)}
          >
            <Image product={product} thumb className="aspect-[3/4] w-full bg-white" fit="contain" />
            <span className="flex flex-col gap-[0.1em] px-[0.6em] py-[0.5em]">
              {/* Four across leaves room for about two words a line, so the
                  "Women's" every name starts with gives way to what the piece is. */}
              <span className="text-label line-clamp-2 leading-tight">
                {withoutWhose(shortName(product))}
              </span>
              <span className="text-label font-semibold tabular-nums">{product.spoken_price}</span>
            </span>
          </button>
        )
      })}
    </Strip>
  )
}

/**
 * A department's shelves, to choose from — the way a film app offers genres.
 *
 * "Men's wear" is not one shelf. This shop's men's pieces are kurtas, pyjamas
 * and pants, and answering the chip with eight kurtas hid the other two. So the
 * panel offers the shelves and the visitor says which, by tapping or out loud.
 *
 * Each tile is one of that shelf's own pieces, standing for the rest.
 */
function Tiles({ shelves }: { shelves: Shelves }) {
  const count = shelves.shelves.length

  return (
    <Strip
      title={shelves.title}
      tally={`${count} ${count === 1 ? 'category' : 'categories'}`}
      // Accessories, reached from the Jewellery tiles, goes back to them.
      back={
        shelves.back
          ? { label: shelves.back.title, to: () => bus.emit('SHELVES_SHOWN', shelves.back!) }
          : undefined
      }
      watch={shelves}
    >
      {shelves.shelves.map((shelf, i) => (
        <button
          key={shelf.category}
          type="button"
          // Most tiles open a shelf. One leads on to another department's
          // tiles: Accessories, last under Jewellery — rakhis and bags are
          // reached from the Jewellery chip without being filed as jewellery.
          onClick={() =>
            void (shelf.opens
              ? showShelves(shelf.opens, shelves, shelves.color)
              : openShelf(shelves.department, shelf.category, shelves.color))
          }
          className={CARD}
          style={arriving(i)}
        >
          <Image product={standIn(shelf)} thumb className="aspect-[3/4] w-full bg-white" fit="contain" />
          {/* The name and nothing else. A count of pieces is stock-keeping, and
              a tile is an invitation. */}
          <span className="text-label line-clamp-2 px-[0.6em] py-[0.5em] leading-tight font-semibold">
            {withoutWhose(shelf.category)}
          </span>
        </button>
      ))}
    </Strip>
  )
}

/** A shelf as the one product `Image` needs: its picture, and its name for the
 *  placeholder a shelf with no photograph gets. */
function standIn(shelf: Shelf): Product {
  return {
    id: shelf.category,
    name: shelf.category,
    category: shelf.category,
    image: shelf.image,
    price: null,
    currency: '',
    spoken_price: '',
    description: '',
    url: '',
    availability: '',
    attributes: {},
  }
}


/** Short enough to be read at a glance, by someone who is not going to read.
 *
 *  This screen used to print every attribute the catalog held, which for a real
 *  storefront meant brand, tags, a variant list repeating the same price four
 *  times, and the raw CDN URL of every image — a wall of text on a shop window.
 *  A visitor here is walking past in an airport: they look at the garment, and
 *  if they want it they scan. Size is the one fact that changes whether it is
 *  worth scanning, so size is the one fact that stays. */
const WORTH_READING = ['size', 'colour', 'color']

function Detail({
  product,
  siblings,
  from,
}: {
  product: Product
  siblings: number
  /** The tiles this product's shelf was opened from, if it was. */
  from: Shelves | null
}) {
  const facts = WORTH_READING.map((k) => product.attributes[k]).filter(Boolean) as string[]
  // Coming from a list of results, "back" means back to those results. Throwing
  // the whole search away because someone looked at one item is the kind of thing
  // that makes a visitor stop touching the screen.
  const toResults = siblings > 1

  return (
    // The garment fills the frame and everything else floats on it.
    //
    // This screen has now been three things: a stacked form, then a photograph
    // with a caption burnt into a heavy gradient, then a picture with the words
    // beneath it. The references settle it — a full-bleed image carrying large,
    // well-spaced type is what an expensive shop window looks like, and the
    // reason the middle attempt read as a streaming thumbnail was the small
    // caption on the heavy scrim, not the technique.
    //
    // `cover` anchored to the top, not `contain`. A garment photograph is shot
    // head-first and the crop lands on hem and floor, so the frame keeps the
    // face, the neckline and the fabric — the parts somebody decides on — and
    // gives up the part they do not.
    <div
      key={product.id}
      // The garment beside the words, not behind them.
      //
      // This was one landscape frame with the photograph cropped to fill it and
      // the text scrimmed over the bottom. A garment photograph is portrait, so
      // cropping it to 16:7 and anchoring the top showed a face and a neckline
      // and cut the dress off — on the one screen whose entire job is showing
      // somebody a dress. The shelf is wide and short, so the picture takes a
      // column of it and keeps its own shape.
      // The same floating panel as the list, in the same place, so opening a
      // piece changes what is in the panel rather than what covers the person.
      className="lay-down bg-canvas/70 border-line/60 shadow-float relative flex flex-col gap-[clamp(10px,1.2vh,44px)] overflow-hidden rounded-[clamp(16px,1.8vh,60px)] border p-[clamp(10px,1.2vh,44px)] backdrop-blur-xl"
    >
      <div className="flex gap-[clamp(12px,1.4vh,52px)]">
        <Gallery product={product} />

        <div className="flex min-w-0 flex-1 flex-col justify-between gap-[1em]">
          <div className="flex min-w-0 flex-col items-start gap-[0.3em]">
            {/* The only way back to the results. It was positioned against the
                full-bleed frame this replaced, so restructuring the layout took
                it off the screen entirely — leaving a selected product with no
                exit but asking out loud. */}
            <button
              type="button"
              // A shelf with one piece on it opens straight to that piece —
              // this shop's men's Pants tile does. Its way back is the tiles it
              // came from, not an empty panel.
              onClick={() =>
                bus.emit(
                  toResults ? 'PRODUCT_DESELECTED' : from ? 'SHELF_CLOSED' : 'PRODUCTS_CLEARED',
                )
              }
              className="border-line/80 text-ink-soft text-label hover:border-ink/25 hover:text-ink mb-[0.4em] rounded-full border px-[1em] py-[0.45em] transition-colors"
            >
              {toResults ? `Back to ${siblings} results` : from ? `Back to ${from.title}` : 'Back'}
            </button>
            <h2
              className="font-display lay-down text-ink text-title line-clamp-3 leading-[1.05] tracking-[-0.01em] text-balance"
              style={{ animationDelay: '90ms' }}
            >
              {product.name}
            </h2>
            <p
              className="lay-down text-ink text-body leading-none font-semibold tabular-nums"
              style={{ animationDelay: '160ms' }}
            >
              {product.spoken_price}
            </p>
            {facts.length > 0 && (
              <p
                className="lay-down text-ink-soft text-label tracking-[0.08em] uppercase opacity-75"
                style={{ animationDelay: '220ms' }}
              >
                {facts.join('   ·   ')}
              </p>
            )}
          </div>

          {/* The two things to do once someone has decided, side by side in the
              flow. "See it on you" used to float in the panel's top corner,
              where the mic and end buttons sat on top of it. */}
          <div className="flex items-end gap-[0.8em]">
            <TryOn product={product} />
            {product.url && scope() !== null && (
              <div
                className="text-ink lay-down border-line/70 flex shrink-0 flex-col items-center gap-[0.4em] rounded-lg border bg-white p-[clamp(6px,0.7vh,26px)]"
                style={{ animationDelay: '300ms' }}
              >
                {/* Ours, not a QR web service — otherwise this is the one element on
                    screen that goes blank when the network drops. An SVG, so it
                    scales to the panel without losing a module. */}
                <img
                  src={`/api/products/${encodeURIComponent(product.id)}/qr?${scope()}`}
                  alt={`QR code linking to ${product.name}`}
                  className="aspect-square w-[clamp(64px,5vh,190px)]"
                />
                <span className="text-label font-medium">Scan to buy</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Its own section, not squeezed into the photograph row — a clip the
          shop published for this product, from the crawler. Muted so autoplay
          is allowed, looped like `Signage`'s campaign clips. Independent of
          the avatar's own "never pause or seek" video system: that rule is
          about the four pose clips, not this. */}
      {product.video && (
        <video
          key={product.video}
          src={product.video}
          autoPlay
          loop
          muted
          playsInline
          className="h-[clamp(120px,14vh,520px)] w-full rounded-lg object-contain"
        />
      )}
    </div>
  )
}

/**
 * What is on the shelf, and how much of it.
 *
 * "8 results" is what a search engine says. A shop says "Sarees", and now that
 * asking for a category returns that category, the panel can say it too — the
 * heading is read off the products themselves rather than the query, so it can
 * only ever describe what is actually underneath it.
 */
/**
 * Every photograph of the garment, one large and the rest as a strip.
 *
 * A storefront publishes six or seven shots — front, back, the fabric close up,
 * worn — and the catalog kept the first and threw the others away. Those are
 * most of what somebody wants before they decide, and on a shop window they are
 * the difference between a picture and a look at the thing.
 *
 * The thumbnails are only drawn when there is more than one, so a product with
 * a single photograph looks exactly as it did rather than growing an empty rail
 * that says something is missing.
 */
function Gallery({ product }: { product: Product }) {
  const shots = (product.images?.length ? product.images : [product.image]).filter(Boolean)
  const [shown, setShown] = useState(0)

  // A different product in the same slot starts at its own first photograph.
  // Without this, selecting a second garment opens on whichever index the last
  // one was left at — which is a picture of the wrong thing, briefly.
  useEffect(() => setShown(0), [product.id])

  // Cycles on its own, the way `Signage` and `AdsRunner` already cycle
  // campaigns — a visitor standing at a shop window does not tap through a
  // garment's photographs, they watch. A manual thumbnail tap still works;
  // the timer just keeps advancing afterward.
  useEffect(() => {
    if (shots.length < 2) return
    const timer = setInterval(() => setShown((i) => (i + 1) % shots.length), 4000)
    return () => clearInterval(timer)
  }, [shots.length])

  const current = shots[Math.min(shown, shots.length - 1)] ?? ''

  return (
    <div className="flex shrink-0 gap-[clamp(8px,0.9vh,32px)]">
      {shots.length > 1 && (
        // No taller than the photograph beside it. Seven shots stacked made the
        // card half the screen high; past the photo's height they scroll.
        <div className="flex max-h-[clamp(160px,22vh,760px)] flex-col gap-[clamp(6px,0.7vh,24px)] overflow-y-auto [scrollbar-width:none]">
          {shots.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => setShown(i)}
              aria-label={`Photograph ${i + 1} of ${shots.length}`}
              aria-current={i === shown}
              className={`w-[clamp(44px,5vh,180px)] shrink-0 overflow-hidden rounded-lg border transition-[border-color,opacity] duration-300 ease-(--ease-human) ${
                i === shown ? 'border-ink/40 opacity-100' : 'border-line/60 opacity-60 hover:opacity-100'
              }`}
            >
              <img src={src} alt="" className="aspect-[3/4] w-full object-cover object-top" />
            </button>
          ))}
        </div>
      )}

      {/* `contain`, and no crop. Whatever the shape of the photograph, the whole
          garment is on screen — which is the difference between a product page
          and a shop window. */}
      <span className="relative block h-[clamp(160px,22vh,760px)] overflow-hidden rounded">
        {current ? (
          <img
            key={current}
            src={current}
            alt=""
            className="animate-[rise_var(--duration-calm)_var(--ease-human)] h-full w-auto object-contain"
          />
        ) : (
          <span
            className="bg-line/30 text-ink-soft grid h-full w-[clamp(150px,20vh,700px)] place-items-center text-xs"
            aria-hidden
          >
            {product.category || 'No image'}
          </span>
        )}
      </span>
    </div>
  )
}

/** Where a strip's Back goes, and what it is called. */
type Back = { label: string; to: () => void }

function Heading({ title, tally, back }: { title: string; tally: string; back?: Back }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-[1em]">
      <div className="flex min-w-0 items-center gap-[0.7em]">
        {/* Back to the tiles this list was opened from. The same pill the
            single-product view uses for its own way back. */}
        {back && (
          <button
            type="button"
            onClick={back.to}
            className="border-line/80 text-ink-soft text-label hover:border-ink/25 hover:text-ink shrink-0 rounded-full border px-[1em] py-[0.45em] transition-colors"
          >
            ‹ {back.label}
          </button>
        )}
        <h2 className="font-display text-body truncate leading-none tracking-[-0.01em]">{title}</h2>
      </div>
      <span className="text-ink-soft text-label shrink-0 tabular-nums">{tally}</span>
    </div>
  )
}

/** The website's own picture of the product, at a card's size. Shopify serves
 *  any width of the same photograph; the originals are 3600px and a strip of
 *  eight of them was the slowest thing on a shop's wifi. */
function thumbUrl(url: string): string {
  if (!url.includes('cdn.shopify.com')) return url
  const u = new URL(url, window.location.href)
  u.searchParams.set('width', '640')
  return u.toString()
}

function Image({
  product,
  className,
  fit,
  thumb = false,
}: {
  product: Product
  className: string
  // A list card: a smaller copy of the same photograph, and not draggable or
  // copyable. The detail view leaves both on.
  thumb?: boolean
  // `cover` fills a grid cell so a row of results lines up; `contain` shows a
  // whole garment on the screen someone decides from. Neither is right for both.
  fit: 'cover' | 'contain'
}) {
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState(false)

  // A new product in the same slot is a new image. Without this the second one
  // inherits the first's `loaded` and skips its own fade, so the grid flickers
  // between two garments instead of changing between them.
  useEffect(() => {
    setLoaded(false)
    setBroken(false)
  }, [product.image])

  // A URL that fails is the same situation as no URL at all, and it happens for
  // real: these point at a supplier's CDN, which goes down, rate-limits, and
  // rewrites its paths without telling anybody. Treating the two cases
  // differently put a browser's broken-image glyph on a shop window — the one
  // graphic on the panel that says the software is faulty.
  if (!product.image || broken) {
    // Catalogs arrive without images more often than not. A tidy placeholder
    // beats a broken icon, and the name is what the visitor is reading anyway.
    return (
      <div
        className={`bg-line/30 text-ink-soft grid place-items-center rounded text-xs ${className}`}
        aria-hidden
      >
        {product.category || 'No image'}
      </div>
    )
  }

  return (
    // The placeholder sits under the image rather than being replaced by it, so
    // there is no moment where the cell is empty. A grid that reflows as each
    // photograph arrives is the single most website-like thing this panel could
    // do, and the aspect ratio is already fixed by the caller for that reason.
    <span className={`relative block overflow-hidden rounded ${className}`}>
      {!loaded && <span aria-hidden className="bg-line/25 shimmering absolute inset-0" />}
      <img
        src={thumb ? thumbUrl(product.image) : product.image}
        alt=""
        draggable={!thumb}
        onContextMenu={thumb ? (e) => e.preventDefault() : undefined}
        onLoad={() => setLoaded(true)}
        // Not "loaded": a failed URL falls back to the placeholder above rather
        // than revealing a broken glyph, and either way the cell stops
        // shimmering — shimmering forever reads as the panel still working.
        onError={() => setBroken(true)}
        className={`h-full w-full ${
          fit === 'cover' ? 'object-cover object-top' : 'object-contain'
        } transition-opacity duration-500 ease-(--ease-human) ${
          loaded ? 'opacity-100' : 'opacity-0'
        }`}
        loading="lazy"
      />
    </span>
  )
}
