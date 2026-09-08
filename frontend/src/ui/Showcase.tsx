import { useEffect, useState } from 'react'
import { bus } from '../bus/bus.ts'
import type { Product } from '../bus/events.ts'
import { scope } from '../provider/http.ts'
import { useStore } from '../state/store.ts'
import { TryOn } from './TryOn.tsx'

/**
 * How much of the panel the products take when they are up, leaving the rest to
 * him. Exported because `Prompts` has to end where this begins: both sit at
 * `z-20` and the suggestions are painted second, so a full-width row of them
 * ran straight under this panel and over the QR card in its bottom corner —
 * a code a visitor is being asked to scan, with a button on top of it.
 */
export const SHOWCASE_WIDTH = '62%'

/**
 * Products, when asked for.
 *
 * Nothing appears until a visitor asks — he is the experience, and a grid of
 * cards on arrival would make this a website with a face on it. When products do
 * appear he does not leave; he moves aside and keeps talking, so the visitor is
 * still being helped by someone rather than browsing alone.
 */
export function Showcase() {
  const { products, selected } = useStore()
  if (!products.length) return null

  return (
    <aside
      style={{ width: SHOWCASE_WIDTH }}
      className="animate-[rise_var(--duration-calm)_var(--ease-human)] bg-canvas/95 absolute inset-y-0 right-0 z-20 flex flex-col gap-[clamp(14px,1.6vh,56px)] px-safe py-safe backdrop-blur-sm"
    >
      {selected ? (
        <Detail product={selected} siblings={products.length} />
      ) : (
        <Grid products={products} />
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

function Grid({ products }: { products: Product[] }) {
  const shelf = sharedCategory(products)

  return (
    <>
      <Heading shelf={shelf} count={products.length} />

      {/* A contact sheet, not a row of cards.
          The card was the problem — a bordered box with a small picture inside a
          lot of padding, which at this scale reads as a spreadsheet of
          thumbnails. Removing the box is the fix; captioning the photograph is
          not, because a caption burnt over a garment is a thumbnail treatment.
          So the image runs edge to edge and the name sits quietly beneath it,
          the way a gallery labels what is on the wall. */}
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-x-[clamp(14px,1.4vh,52px)] gap-y-[clamp(18px,1.9vh,68px)] overflow-y-auto">
        {products.map((product, i) => (
          <button
            key={product.id}
            type="button"
            onClick={() => bus.emit('PRODUCT_SELECTED', { product })}
            // Laid out one after another rather than all at once. Capped at
            // eight steps so a longer list never turns the wait into a queue —
            // past that they arrive together, which nobody reads as a fault.
            className="lay-down group flex flex-col gap-[0.55em] text-left"
            style={{ animationDelay: `${Math.min(i, 8) * 55}ms` }}
          >
            <Image
              product={product}
              className="aspect-[3/4] transition-transform duration-700 ease-(--ease-human) group-hover:scale-[1.02] group-active:scale-[0.99]"
              fit="cover"
            />
            <span className="font-display line-clamp-2 text-body leading-[1.15] text-balance">
              {product.name}
            </span>
            <span className="text-ink-soft text-label tabular-nums">{product.spoken_price}</span>
          </button>
        ))}
      </div>
    </>
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
      className="lay-down bg-line/20 relative min-h-0 flex-1 overflow-hidden rounded-xl"
    >
      {/* The one still on the panel that moves. A garment photograph held
          perfectly steady for a minute is a poster; this is slow enough that
          nobody catches it moving and enough that the frame stays alive. */}
      <Image product={product} className="drifting absolute inset-0 h-full" fit="cover" />

      <button
        type="button"
        onClick={() => bus.emit(toResults ? 'PRODUCT_DESELECTED' : 'PRODUCTS_CLEARED')}
        className="absolute top-[clamp(12px,1.4vh,50px)] left-[clamp(12px,1.4vh,50px)] rounded-full bg-black/35 px-[1em] py-[0.5em] text-label text-white backdrop-blur-md transition-colors hover:bg-black/50"
      >
        {toResults ? `Back to ${siblings} results` : 'Back'}
      </button>

      {/* One scrim, from the foot of the frame, doing nothing above the words
          it exists for. The garment keeps its light. */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-[2em] bg-linear-to-t from-black/85 via-black/45 to-transparent p-[clamp(16px,1.8vh,64px)] pt-[22%] text-white">
        <div className="flex min-w-0 flex-col gap-[0.3em]">
          <h2
            className="font-display lay-down text-display leading-[1.02] tracking-[-0.015em] text-balance"
            style={{ animationDelay: '90ms' }}
          >
            {product.name}
          </h2>
          <p
            className="lay-down text-title leading-none tabular-nums"
            style={{ animationDelay: '160ms' }}
          >
            {product.spoken_price}
          </p>
          {facts.length > 0 && (
            <p
              className="lay-down text-label tracking-[0.08em] uppercase opacity-75"
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
            className="text-ink lay-down flex shrink-0 flex-col items-center gap-[0.5em] rounded-lg bg-white/95 p-[clamp(8px,0.9vh,32px)] shadow-float backdrop-blur-md"
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
function Heading({ shelf, count }: { shelf: string; count: number }) {
  const piece = count === 1 ? 'piece' : 'pieces'

  return (
    <div className="flex shrink-0 flex-col gap-[0.5em]">
      <div className="flex items-baseline justify-between gap-[1em]">
        <h2 className="font-display text-title leading-none tracking-[-0.01em]">
          {shelf || 'Selected for you'}
        </h2>
        <span className="text-ink-soft text-label shrink-0 tabular-nums">
          {count} {piece}
        </span>
      </div>
      {/* Drawn from the left as the products land, so the page reads as being
          set rather than as having been there all along. */}
      <span
        aria-hidden
        className="bg-line h-px origin-left animate-[draw_520ms_var(--ease-human)]"
      />
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
        className={`bg-line/30 text-ink-soft grid w-full place-items-center rounded text-xs ${className}`}
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
    <span className={`relative block w-full overflow-hidden rounded ${className}`}>
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
