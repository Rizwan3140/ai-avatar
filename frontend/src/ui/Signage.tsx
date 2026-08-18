import { useEffect, useState } from 'react'
import { useStore } from '../state/store.ts'

/**
 * What the screen does when nobody is talking to it.
 *
 * A showroom kiosk is idle for most of its working life, and a man standing
 * perfectly still for an hour is neither an advertisement nor a person. So idle
 * time becomes signage — and unlike a normal display, this one can invite you in,
 * because there is someone standing next to the campaign who will answer.
 *
 * He stays visible throughout. The moment anyone taps the microphone the
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [index, setIndex] = useState(0)

  const idle = status === 'idle'

  useEffect(() => {
    if (!avatarId) return
    fetch(`/api/campaigns/${encodeURIComponent(avatarId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setCampaigns)
      .catch(() => setCampaigns([]))
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
    // Right of him, and clear of the control rail — which is also anchored right
    // and also vertically centred, so a panel running to `right-0` puts the
    // microphone button on top of the advertisement. The reserved gutter is the
    // rail's own width plus its safe margin.
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-10 flex w-[46%] flex-col justify-center gap-5 pr-[132px] pl-safe"
      style={{ animation: `rise var(--duration-calm) var(--ease-human)` }}
    >
      <div key={campaign.id} className="animate-[rise_600ms_var(--ease-human)] overflow-hidden rounded-xl">
        {campaign.kind === 'video' ? (
          <video src={campaign.src} muted loop autoPlay playsInline className="w-full object-contain" />
        ) : (
          <img src={campaign.src} alt="" className="w-full object-contain" />
        )}
      </div>

      {campaign.invitation && (
        <p className="text-ink text-center text-[clamp(15px,2vh,20px)] leading-relaxed text-balance">
          {campaign.invitation}
        </p>
      )}
    </div>
  )
}

