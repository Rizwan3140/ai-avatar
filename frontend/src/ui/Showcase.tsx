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
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-4 overflow-y-auto">
        {products.map((product) => (
          <button
            key={product.id}
            type="button"
            onClick={() => bus.emit('PRODUCT_SELECTED', { product })}
            className="group flex flex-col gap-2 rounded-lg border border-line bg-white p-4 text-left transition-transform duration-200 ease-(--ease-human) hover:-translate-y-0.5"
          >
            <Image product={product} className="h-28" />
            <span className="text-[15px] leading-tight font-medium">{product.name}</span>
            <span className="text-ink-soft text-sm">{product.spoken_price}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function Detail({ product, siblings }: { product: Product; siblings: number }) {
  const specs = Object.entries(product.attributes).filter(([, v]) => v)
  // Coming from a list of results, "back" means back to those results. Throwing
  // the whole search away because someone looked at one item is the kind of thing
  // that makes a visitor stop touching the screen.
  const toResults = siblings > 1

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[26px] leading-tight font-semibold tracking-tight text-balance">
            {product.name}
          </h2>
          <p className="text-ink-soft text-lg">{product.spoken_price}</p>
        </div>
        <button
          type="button"
          onClick={() => bus.emit(toResults ? 'PRODUCT_DESELECTED' : 'PRODUCTS_CLEARED')}
          className="text-ink-soft shrink-0 rounded-full border border-line px-3 py-1.5 text-xs transition-colors hover:bg-line/40"
        >
          {toResults ? `Back to ${siblings} results` : 'Back'}
        </button>
      </div>

      <Image product={product} className="h-[34%]" />

      {product.description && (
        <p className="text-[15px] leading-relaxed text-ink-soft">{product.description}</p>
      )}

      {specs.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line pt-4 text-sm">
          {specs.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="text-ink-soft capitalize">{key.replace(/_/g, ' ')}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Offered on the product being discussed, not on the grid — "see it on
          you" only means anything once there is a single "it". Renders nothing
          when no provider is configured or the product has no image. */}
      <TryOn product={product} />

      {product.url && scope() !== null && (
        <div className="mt-auto flex items-center gap-4 border-t border-line pt-4">
          {/* Rendered by our own API, not a QR web service — otherwise this is
              the one element on screen that goes blank when the network drops. */}
          <img
            src={`/api/products/${encodeURIComponent(product.id)}/qr?${scope()}`}
            alt={`QR code linking to ${product.name}`}
            width={76}
            height={76}
            className="shrink-0 rounded bg-white"
          />
          <p className="text-ink-soft text-sm">
            Scan to take this with you
            <br />
            <span className="text-xs">Keep asking — he is still listening.</span>
          </p>
        </div>
      )}
    </>
  )
}

function Heading({ count }: { count: number }) {
  return (
    <h2 className="text-ink-soft text-xs font-medium tracking-[0.14em] uppercase">
      {count} {count === 1 ? 'result' : 'results'}
    </h2>
  )
}

function Image({ product, className }: { product: Product; className: string }) {
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
      className={`w-full rounded object-contain ${className}`}
      loading="lazy"
    />
  )
}

