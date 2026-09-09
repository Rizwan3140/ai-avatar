import { useEffect, useState } from 'react'
import { useStore } from '../state/store.ts'
import { useBurnInShift } from './useBurnInShift.ts'

/**
 * What the screen does when nobody is talking to it.
 *
 * A showroom kiosk is idle for most of its working life, and a man standing
 * perfectly still for an hour is neither an advertisement nor a person. So idle
 * time becomes signage — and unlike a normal display, this one can invite you in,
 * because there is someone standing next to the campaign who will answer.
 *
 * They stays visible throughout. The moment anyone taps the microphone the
 * campaign is gone, because the conversation is the product and the advertising
 * is what fills the gaps.
 */
type Campaign = {
  id: string
  src: string
  kind: 'image' | 'video'
  invitation: string
  seconds: number
}

export function Signage() {
  const status = useStore((s) => s.status)
  const avatarId = useStore((s) => s.avatarId)
  const shift = useBurnInShift()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [index, setIndex] = useState(0)

  // Only asleep. This ran during `idle` too, which is the state a cabinet is in
  // before anybody has said a word to it — so the advertising was up beside them
  // from the moment the page loaded, competing with the person who is supposed
  // to be the first thing you notice.
  //
  // Sleep is different: ten minutes with nobody there, no avatar on screen, and
  // a dark shop window on a concourse reads as broken. Then it is a screensaver,
  // it takes the whole frame, and a touch brings them back.
  const asleep = status === 'sleeping'
  const idle = asleep

  useEffect(() => {
    if (!avatarId) return
    fetch(`/api/campaigns/${encodeURIComponent(avatarId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: Campaign[]) => {
        setCampaigns(list)
        // App needs to know too: the black sleep scrim has to lift for a
        // cabinet with campaigns and stay for one without.
        useStore.setState({ hasCampaigns: list.length > 0 })
      })
      .catch(() => {
        setCampaigns([])
        useStore.setState({ hasCampaigns: false })
      })
  }, [avatarId])

  // Advance the playlist. Only while idle — a timer running behind a
  // conversation would resume mid-sentence on a campaign nobody asked to see.
  useEffect(() => {
    if (!idle || campaigns.length < 2) return
    const current = campaigns[index % campaigns.length]
    const timer = setTimeout(
      () => setIndex((i) => (i + 1) % campaigns.length),
      (current?.seconds || 8) * 1000,
    )
    return () => clearTimeout(timer)
  }, [idle, index, campaigns])

  // Restart the playlist after each conversation, so the next visitor sees the
  // campaign from its beginning rather than halfway through.
  useEffect(() => {
    if (!idle) setIndex(0)
  }, [idle])

  if (!idle || !campaigns.length) return null
  const campaign = campaigns[index % campaigns.length]

  return (
    // While they are present: right of them, and clear of the control rail — which
    // is also anchored right and also vertically centred, so a panel running to
    // `right-0` puts the microphone button on top of the advertisement. The
    // reserved gutter is the rail's own width plus its safe margin.
    //
    // Asleep: the whole frame. They are not on screen and the controls are not
    // reachable, so nothing is being covered.
    //
    // The drift is the same slow cycle the wordmark and the controls use. It
    // matters more here than anywhere else in the app: this is the change that
    // puts a lit image on a transparent OLED for hours at a time, which is
    // exactly what sleeping was avoiding. Rotating the playlist does most of the
    // work; moving it does the rest. One campaign looping alone will still ghost.
    <div
      className={`pointer-events-none absolute inset-y-0 right-0 z-10 flex flex-col justify-center gap-5 transition-transform duration-1000 ${
        asleep ? 'w-full' : 'w-[46%] pl-safe pr-[132px]'
      }`}
      style={{
        animation: `rise var(--duration-calm) var(--ease-human)`,
        transform: `translate(${shift.x}px, ${shift.y}px)`,
      }}
    >
      {/*
        Asleep, the artwork fills the panel: `cover`, full height, no rounding
        and no safe padding. It was `contain` with a width and no height, which
        letterboxes — a 52" shop window running an advertisement with white bars
        down two sides, which reads as a mistake rather than a campaign.

        Beside them it stays `contain`, and that is not an inconsistency. The
        panel is 2160x3840 — portrait — so their gutter is a tall narrow column,
        and `cover` there would crop a landscape advert to a vertical slice
        through its middle. Filling the frame is right when the frame is the
        whole screen and wrong when it is a sliver.
      */}
      <div
        key={campaign.id}
        className={`animate-[rise_600ms_var(--ease-human)] overflow-hidden ${
          asleep ? 'min-h-0 flex-1' : 'rounded-xl'
        }`}
      >
        {campaign.kind === 'video' ? (
          <video
            src={campaign.src}
            muted
            loop
            autoPlay
            playsInline
            className={asleep ? 'h-full w-full object-cover' : 'w-full object-contain'}
          />
        ) : (
          <img
            src={campaign.src}
            alt=""
            className={asleep ? 'h-full w-full object-cover' : 'w-full object-contain'}
          />
        )}
      </div>

      {campaign.invitation && (
        <p className="text-ink text-center text-title leading-relaxed text-balance">
          {campaign.invitation}
        </p>
      )}
    </div>
  )
}

