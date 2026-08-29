import { bus } from '../bus/bus.ts'
import type { Product } from '../bus/events.ts'
import { scope } from '../provider/http.ts'
import { useStore } from '../state/store.ts'
import { TryOn } from './TryOn.tsx'

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
    <aside className="animate-[rise_var(--duration-calm)_var(--ease-human)] absolute inset-y-0 right-0 z-20 flex w-[62%] flex-col gap-5 bg-canvas/95 px-safe py-safe backdrop-blur-sm">
      {selected ? (
        <Detail product={selected} siblings={products.length} />
      ) : (
        <Grid products={products} />
      )}
    </aside>
  )
}

function Grid({ products }: { products: Product[] }) {
  return (
    <>
      <Heading count={products.length} />
      {/* The garment is the card, not the thing inside one.
          A picture with a heading and a price stacked beneath it, repeated in a
          bordered box, is the lazy container — and at this scale it reads as a
          spreadsheet of thumbnails rather than a rail of clothes. The words move
          onto the image, over a scrim that only exists where they sit, so a row
          of results reads as garments first and as an interface second. */}
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-[clamp(12px,1.2vh,44px)] overflow-y-auto">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => bus.emit('PRODUCT_SELECTED', { product })}
            className="group relative aspect-[3/4] overflow-hidden rounded-lg text-left transition-transform duration-300 ease-(--ease-human) hover:-translate-y-1"
          >
            <Image product={product} className="absolute inset-0 h-full" fit="cover" />
            {/* Bottom third only. A scrim across the whole image would dull the
                garment to make room for two lines of type. */}
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-[0.35em] bg-linear-to-t from-black/75 via-black/45 to-transparent p-[clamp(10px,1.1vh,40px)] pt-[12%] text-white">
              <span className="line-clamp-2 text-body leading-tight font-medium text-balance">
                {product.name}
              </span>
              <span className="text-label tabular-nums opacity-90">{product.spoken_price}</span>
            </div>
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
    <>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => bus.emit(toResults ? 'PRODUCT_DESELECTED' : 'PRODUCTS_CLEARED')}
          className="text-ink-soft shrink-0 rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:bg-line/40"
        >
          {toResults ? `Back to ${siblings} results` : 'Back'}
        </button>
      </div>

      {/* The garment, and its name written on it.
          Stacked as a picture then a heading then a price then a row of facts,
          this read as a form with a photograph at the top of it. A shop window
          is not a form. The image takes the room, the words sit on its lower
          edge where a lookbook would put them, and the two stop competing for
          the same vertical space.

          `contain`, not `cover` — a cropped hemline on the screen somebody is
          deciding from is the wrong economy, so the frame gives the garment its
          whole silhouette and lets the panel show through around it. */}
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg">
        <Image product={product} className="absolute inset-0 h-full" fit="contain" />
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-[0.3em] bg-linear-to-t from-black/80 via-black/50 to-transparent p-[clamp(14px,1.5vh,56px)] pt-[10%] text-white">
          <h2 className="text-display leading-[1.03] font-semibold tracking-[-0.02em] text-balance">
            {product.name}
          </h2>
          <p className="text-title leading-none tabular-nums">{product.spoken_price}</p>
          {facts.length > 0 && <p className="text-label opacity-80">{facts.join('  ·  ')}</p>}
        </div>
      </div>

      {/* Offered on the product being discussed, not on the grid — "see it on
          you" only means anything once there is a single "it". Renders nothing
          when no provider is configured or the product has no image. */}
      <TryOn product={product} />

      {product.url && scope() !== null && (
        // The point of the whole screen. It was 76px in a footer under a spec
        // table; nobody crossing a concourse takes their phone out for that.
        <div className="mt-auto flex items-center gap-5 border-t border-line pt-5">
          {/* Rendered by our own API, not a QR web service — otherwise this is
              the one element on screen that goes blank when the network drops. */}
          {/* Scales with the panel like everything else. It is an SVG, so there
              is no resolution to lose, and this is the one element a visitor
              points a phone camera at from half a metre away, through glass,
              at an angle — 132px was about forty millimetres of code. */}
          <img
            src={`/api/products/${encodeURIComponent(product.id)}/qr?${scope()}`}
            alt={`QR code linking to ${product.name}`}
            className="aspect-square w-[clamp(104px,7vh,272px)] shrink-0 rounded bg-white"
          />
          <p className="text-body leading-snug font-medium">
            Scan to buy this
            <br />
            <span className="text-ink-soft text-label font-normal">
              Opens on your phone. Keep asking — he is still listening.
            </span>
          </p>
        </div>
      )}
    </>
  )
}

function Heading({ count }: { count: number }) {
  return (
    <h2 className="text-ink-soft text-label font-medium tracking-[0.14em] uppercase">
      {count} {count === 1 ? 'result' : 'results'}
    </h2>
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
  if (!product.image) {
    // Catalogs arrive without images more often than not. A tidy placeholder
    // beats a broken icon, and the name is what the visitor is reading anyway.
    return (
      <div
        className={`grid w-full place-items-center rounded bg-line/30 text-ink-soft text-xs ${className}`}
        aria-hidden
      >
        {product.category || 'No image'}
      </div>
    )
  }
  return (
    <img
      src={product.image}
      alt=""
      className={`w-full rounded ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${className}`}
      loading="lazy"
    />
  )
}

