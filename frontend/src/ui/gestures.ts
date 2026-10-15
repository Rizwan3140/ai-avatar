/**
 * What a hand in front of the cabinet means, one camera frame at a time.
 *
 * A showroom panel is touched by everybody who walks up to it, so everything
 * the shelf asks a finger for can also be done in the air (`AirHand.tsx`):
 *
 * - point, and hold over something: it is tapped
 * - an open hand swept sideways: the next or previous products
 * - an open palm held still, like "stop": Back
 * - a thumb up, held: start talking
 *
 * Holding is the whole defence against a room full of people who are not
 * gesturing at anything: nothing fires on a glimpse, and the cursor shows the
 * hold filling, so whoever is doing it sees it coming and can stop.
 *
 * Pure: positions arrive already mapped to the screen (0..1, as the visitor
 * sees it, so moving their hand left moves the cursor left), and what comes
 * back is what to do. The DOM and the camera live in `AirHand`.
 */

export type Pose = 'point' | 'palm' | 'thumb' | 'other'

export type Hand = {
  /** Where the index fingertip points on the screen. */
  x: number
  y: number
  /** The wrist, for sweeps: it moves with the arm and not with the fingers. */
  wx: number
  wy: number
  pose: Pose
}

export type Action = { kind: 'tap' } | { kind: 'back' } | { kind: 'talk' } | { kind: 'swipe'; dir: 1 | -1 }

export type Hold = { kind: 'tap' | 'back' | 'talk'; progress: number }

/** How long each hold takes, in ms. Shorter is quicker to use and quicker to
 *  fire by accident; these were chosen at a desk, not in a showroom. */
export const HOLD = { tap: 1000, back: 1200, talk: 1000 }
/** A sweep: this far across the screen (a fraction of its width), within this
 *  long, and mostly sideways. */
export const SWEEP = { distance: 0.22, within: 450 }
/** How far a palm or thumb may drift and still be holding still. */
const STILL = 0.06
/** A hand missing for less than this is the detector blinking, not the
 *  visitor leaving. */
const BLINK = 300
/** After a sweep, another the same way soon after is wanted - flicking
 *  through a rail - while one the other way is the hand coming back. */
const AGAIN = 400
const RETURN = 1100

/**
 * The shape of a hand, from MediaPipe's own reading of it where it has one.
 * Its "Pointing_Up" needs the finger upright; a finger pointed at the panel is
 * foreshortened and comes back as nothing, so pointing is also read from the
 * landmarks: the index finger out, the middle and ring fingers folded.
 */
export function poseOf(category: string, points: { x: number; y: number }[]): Pose {
  if (category === 'Pointing_Up') return 'point'
  if (category === 'Open_Palm') return 'palm'
  if (category === 'Thumb_Up') return 'thumb'
  if (points.length < 21) return 'other'
  const out = (tip: number, knuckle: number) => far(points[0], points[tip]) > far(points[0], points[knuckle]) * 1.15
  return out(8, 6) && !out(12, 10) && !out(16, 14) ? 'point' : 'other'
}

const far = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * One reader per camera. Feed it every frame, `null` when there is no hand;
 * `target` is whatever the fingertip is over (anything comparable - the
 * element, in the panel), so a tap only fills while it stays on one thing.
 */
export function reader() {
  let trail: { t: number; x: number; y: number }[] = []
  let hold: { kind: Hold['kind']; since: number; x: number; y: number; target: unknown; spent: boolean } | null = null
  let seen = -Infinity
  let swept: { t: number; dir: 1 | -1 } | null = null

  return function step(t: number, hand: Hand | null, target: unknown = null): { fire?: Action; hold?: Hold } {
    if (!hand) {
      if (t - seen > BLINK) {
        hold = null
        trail = []
      }
      return hold && !hold.spent ? { hold: { kind: hold.kind, progress: (t - hold.since) / HOLD[hold.kind] } } : {}
    }
    seen = t

    // A sweep. Not while pointing: moving the cursor quickly is not a sweep.
    if (hand.pose === 'point') trail = []
    else {
      trail = trail.filter((p) => t - p.t <= SWEEP.within)
      trail.push({ t, x: hand.wx, y: hand.wy })
      const dx = hand.wx - trail[0].x
      const dy = hand.wy - trail[0].y
      if (Math.abs(dx) >= SWEEP.distance && Math.abs(dx) > 2 * Math.abs(dy)) {
        // Hand to the left brings in what is to the right, as on a phone.
        const dir: 1 | -1 = dx < 0 ? 1 : -1
        const wait = swept ? (swept.dir === dir ? AGAIN : RETURN) : 0
        trail = []
        hold = null
        if (!swept || t - swept.t >= wait) {
          swept = { t, dir }
          return { fire: { kind: 'swipe', dir } }
        }
        return {}
      }
    }

    const kind = hand.pose === 'point' ? 'tap' : hand.pose === 'palm' ? 'back' : hand.pose === 'thumb' ? 'talk' : null
    const moved = hold && kind !== 'tap' && far(hold, { x: hand.wx, y: hand.wy }) > STILL
    if (!kind || (kind === 'tap' && target === null)) hold = null
    else if (!hold || hold.kind !== kind || hold.target !== target || moved) {
      hold = { kind, since: t, x: hand.wx, y: hand.wy, target, spent: false }
    }
    if (!hold || hold.spent) return {}

    const progress = (t - hold.since) / HOLD[hold.kind]
    if (progress < 1) return { hold: { kind: hold.kind, progress } }
    // Once per hold: the same palm still raised does not go Back twice.
    hold.spent = true
    return { fire: { kind: hold.kind } }
  }
}

/**
 * Whether this cabinet reads hands, remembered by the browser like the
 * camera's turn: `?gestures=0` switches it off on that machine, `?gestures=1`
 * back on. On unless told otherwise.
 */
export function gesturesOn(
  from: { search: string; storage?: Pick<Storage, 'getItem' | 'setItem'> } = {
    search: globalThis.location?.search ?? '',
    storage: globalThis.localStorage,
  },
): boolean {
  const KEY = 'luxora.gestures'
  try {
    const said = new URLSearchParams(from.search).get('gestures')
    if (said !== null) from.storage?.setItem(KEY, said === '0' ? '0' : '1')
    return from.storage?.getItem(KEY) !== '0'
  } catch {
    return true
  }
}
