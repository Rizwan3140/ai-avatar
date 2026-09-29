import { type RefObject, useEffect, useRef, useState } from 'react'
import { bus } from '../bus/bus.ts'
import type { Product } from '../bus/events.ts'
import { scope } from '../provider/http.ts'
import { useStore } from '../state/store.ts'
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
  const { products, selected } = useStore()
  if (!products.length) return null

  return (
    // A shelf floating over them, not one that pushes them up to make room.
    // Translucent and blurred rather than the opaque `bg-canvas` this used to
    // be — the whole point is that they are still visible behind it, full
    // height, while what they are showing sits over the lower part of them.
    // The shelf of results is its own floating panel, so here the band is
    // transparent and only keeps it off the edges; one product keeps the band.
    <aside
      className={`lay-down absolute inset-x-0 bottom-0 z-10 flex flex-col gap-[clamp(10px,1.1vh,40px)] ${
        selected
          ? 'bg-canvas/85 px-safe pb-safe pt-[clamp(12px,1.3vh,48px)] backdrop-blur-md'
          : 'px-[clamp(28px,3vh,110px)] pb-[clamp(24px,3vh,110px)]'
      }`}
    >
      {selected ? (
        <Detail product={selected} siblings={products.length} />
      ) : (
        <Rail products={products} />
      )}
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

/** "Dhiyona FL Women's Pink Top" as its brand over what it is — the two lines a
 *  card has room for, instead of one name cut off mid-word. */
function splitName(product: Product): [string, string] {
  const brand = String(product.attributes?.brand ?? '').trim()
  if (brand && product.name.startsWith(brand) && product.name.length > brand.length) {
    return [brand, product.name.slice(brand.length).trim()]
  }
  return [product.name, product.category ?? '']
}

function Rail({ products }: { products: Product[] }) {
  const shelf = sharedCategory(products)
  const row = useRef<HTMLDivElement>(null)
  const [all, setAll] = useState(false)
  const [edge, setEdge] = useState({ start: true, end: products.length <= 3 })
  useSideScroll(row)

  // Which arrows mean anything right now. An arrow that does nothing at the end
  // of the row reads as a broken button.
  useEffect(() => {
    const el = row.current
    if (!el) return
    const measure = () =>
      setEdge({
        start: el.scrollLeft <= 4,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
      })
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    return () => el.removeEventListener('scroll', measure)
  }, [products, all])

  const page = (dir: 1 | -1) =>
    row.current?.scrollBy({ left: dir * row.current.clientWidth, behavior: 'smooth' })

  return (
    // A panel floating over them rather than a band across the bottom: three
    // pieces at a time, so each is big enough to judge from where a visitor
    // stands. Swipe and drag still move the row; the arrows are for the visitor
    // who does not think to.
    <div className="lay-down bg-canvas/70 border-line/60 shadow-float relative flex flex-col gap-[clamp(12px,1.3vh,48px)] rounded-[clamp(18px,2vh,64px)] border p-[clamp(14px,1.6vh,56px)] backdrop-blur-xl">
      <Heading
        shelf={shelf}
        count={products.length}
        all={all}
        onToggle={products.length > 3 ? () => setAll((a) => !a) : undefined}
      />

      <div
        ref={row}
        className={`flex gap-[clamp(10px,1.1vh,40px)] select-none [scrollbar-width:none] ${
          all ? 'flex-wrap' : 'snap-x snap-mandatory overflow-x-auto'
        }`}
      >
        {products.map((product, i) => {
          const [brand, rest] = splitName(product)
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => bus.emit('PRODUCT_SELECTED', { product })}
              // Laid out one after another rather than all at once. Capped at
              // eight steps so a longer list never turns the wait into a queue —
              // past that they arrive together, which nobody reads as a fault.
              className="lay-down border-line/60 bg-canvas group flex w-[calc((100%-2*clamp(10px,1.1vh,40px))/3)] shrink-0 snap-start flex-col overflow-hidden rounded-[clamp(12px,1.3vh,44px)] border text-left shadow-sm transition-[box-shadow,transform] duration-300 ease-(--ease-human) hover:shadow-float active:scale-[0.98]"
              style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}
            >
              <Image
                product={product}
                className="aspect-[4/5] w-full transition-transform duration-700 ease-(--ease-human) group-hover:scale-[1.03]"
                fit="cover"
              />
              <span className="flex flex-col gap-[0.15em] p-[clamp(10px,1.1vh,40px)]">
                <span className="font-display text-body line-clamp-1 leading-tight">{brand}</span>
                {rest && <span className="text-ink-soft text-label line-clamp-1">{rest}</span>}
                <span className="text-body mt-[0.3em] font-semibold tabular-nums">
                  {product.spoken_price}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {!all && products.length > 3 && (
        <>
          <Arrow side="left" hidden={edge.start} onClick={() => page(-1)} />
          <Arrow side="right" hidden={edge.end} onClick={() => page(1)} />
        </>
      )}
    </div>
  )
}

function Arrow({ side, hidden, onClick }: { side: 'left' | 'right'; hidden: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Previous pieces' : 'More pieces'}
      onClick={onClick}
      tabIndex={hidden ? -1 : 0}
      className={`bg-canvas text-ink shadow-float absolute top-[55%] flex size-[clamp(40px,4.4vh,150px)] -translate-y-1/2 items-center justify-center rounded-full border border-line/60 transition-opacity duration-300 active:scale-95 ${
        side === 'left' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'
      } ${hidden ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
    >
      <svg viewBox="0 0 24 24" className="size-[45%]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={side === 'left' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7'} />
      </svg>
    </button>
  )
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

function Detail({ product, siblings }: { product: Product; siblings: number }) {
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
      className="lay-down bg-line/20 relative flex flex-col gap-[clamp(12px,1.4vh,52px)] overflow-hidden rounded-xl p-[clamp(12px,1.4vh,52px)]"
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
              onClick={() => bus.emit(toResults ? 'PRODUCT_DESELECTED' : 'PRODUCTS_CLEARED')}
              className="border-line/80 text-ink-soft text-label hover:border-ink/25 hover:text-ink mb-[0.4em] rounded-full border px-[1em] py-[0.45em] transition-colors"
            >
              {toResults ? `Back to ${siblings} results` : 'Back'}
            </button>
            <h2
              className="font-display lay-down text-ink text-display leading-[1.02] tracking-[-0.015em] text-balance"
              style={{ animationDelay: '90ms' }}
            >
              {product.name}
            </h2>
            <p
              className="lay-down text-ink-soft text-title leading-none tabular-nums"
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

          {product.url && scope() !== null && (
            // The card the whole screen is for, floated on the photograph rather
            // than filed in a footer under it. Arriving last, after the name and
            // the price, because it is the thing to do once you have decided.
            <div
              className="text-ink lay-down border-line/70 flex shrink-0 flex-col items-center gap-[0.5em] self-start rounded-lg border bg-white p-[clamp(8px,0.9vh,32px)]"
              style={{ animationDelay: '300ms' }}
            >
              {/* Ours, not a QR web service — otherwise this is the one element on
                  screen that goes blank when the network drops. An SVG, so it
                  scales to the panel without losing a module. */}
              <img
                src={`/api/products/${encodeURIComponent(product.id)}/qr?${scope()}`}
                alt={`QR code linking to ${product.name}`}
                className="aspect-square w-[clamp(84px,6vh,232px)]"
              />
              <span className="text-label font-medium">Scan to buy</span>
            </div>
          )}
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
          className="h-[clamp(200px,26vh,900px)] w-full rounded-lg object-contain"
        />
      )}

      {/* Offered on the product being discussed, not on the grid — "see it on
          you" only means anything once there is a single "it". Renders nothing
          when no provider is configured or the product has no image. */}
      <div className="absolute top-[clamp(12px,1.4vh,50px)] right-[clamp(12px,1.4vh,50px)]">
        <TryOn product={product} />
      </div>
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
        <div className="flex flex-col gap-[clamp(6px,0.7vh,24px)] overflow-y-auto">
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
      <span className="relative block h-[clamp(200px,26vh,900px)] overflow-hidden rounded">
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

function Heading({
  shelf,
  count,
  all,
  onToggle,
}: {
  shelf: string
  count: number
  all?: boolean
  onToggle?: () => void
}) {
  const piece = count === 1 ? 'piece' : 'pieces'

  return (
    <div className="flex shrink-0 items-baseline justify-between gap-[1em]">
      <h2 className="font-display text-title leading-none tracking-[-0.01em]">
        {shelf || 'Selected for you'}
      </h2>
      {onToggle ? (
        // Opens the row out to every piece at once, and back.
        <button
          type="button"
          onClick={onToggle}
          className="text-ink-soft text-label flex shrink-0 items-center gap-[0.4em] tabular-nums active:opacity-60"
        >
          {all ? 'Show fewer' : `See all (${count})`}
          <span aria-hidden>{all ? '↑' : '→'}</span>
        </button>
      ) : (
        <span className="text-ink-soft text-label shrink-0 tabular-nums">
          {count} {piece}
        </span>
      )}
    </div>
  )
}

function Image({
  product,
  className,
  fit,
}: {
  product: Product
  className: string
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
        src={product.image}
        alt=""
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
