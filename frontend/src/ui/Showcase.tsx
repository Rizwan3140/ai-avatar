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
      {/* A contact sheet, not a row of cards.
          The card was the problem — a bordered box with a small picture inside a
          lot of padding, which at this scale reads as a spreadsheet of
          thumbnails. Removing the box is the fix; captioning the photograph is
          not, because a caption burnt over a garment is a thumbnail treatment.
          So the image runs edge to edge and the name sits quietly beneath it,
          the way a gallery labels what is on the wall. */}
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-x-[clamp(14px,1.4vh,52px)] gap-y-[clamp(18px,1.9vh,68px)] overflow-y-auto">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => bus.emit('PRODUCT_SELECTED', { product })}
            className="group flex flex-col gap-[0.55em] text-left"
          >
            <Image
              product={product}
              className="aspect-[3/4] transition-[filter,transform] duration-500 ease-(--ease-human) group-hover:scale-[1.015]"
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
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-line/20">
      <Image product={product} className="absolute inset-0 h-full" fit="cover" />

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
          <h2 className="font-display text-display leading-[1.02] tracking-[-0.015em] text-balance">
            {product.name}
          </h2>
          <p className="text-title leading-none tabular-nums">{product.spoken_price}</p>
          {facts.length > 0 && (
            <p className="text-label tracking-[0.08em] uppercase opacity-75">
              {facts.join('   ·   ')}
            </p>
          )}
        </div>

        {product.url && scope() !== null && (
          // The card the whole screen is for, floated on the photograph rather
          // than filed in a footer under it.
          <div className="flex shrink-0 flex-col items-center gap-[0.5em] rounded-lg bg-white/95 p-[clamp(8px,0.9vh,32px)] text-ink shadow-float backdrop-blur-md">
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
      className={`w-full rounded ${fit === 'cover' ? 'object-cover object-top' : 'object-contain'} ${className}`}
      loading="lazy"
    />
  )
}

