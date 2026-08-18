# UI/UX Design Specification

## Aurora — AI Avatar Builder Platform for Transparent OLED Displays

**Version:** 2.0
**Status:** Draft for Approval
**Supersedes:** `03-UIUX-Spec.docx` (v1.0)
**Companion documents:** `01-PRD.md`, `02-SRS.md`

---

## 1. Design Philosophy

The interface exists to disappear behind Nova. On a **vertical transparent OLED panel mounted in a white cabinet with a white hollow interior**, every pixel the UI turns "off" doesn't vanish into black — it reveals the physical white backing behind the glass. That single hardware fact governs this entire document and is a deliberate departure from generic transparent-OLED guidance (which typically assumes a dark room and a black void): **this platform is designed for a bright, gallery-white reveal, not a dark one.**

Three principles govern every decision:

- **Avatar-first:** Nova is always the visual anchor; UI chrome supports her, never competes with her.
- **White-reveal native:** content is designed as if painted onto a white gallery wall, not glowing out of darkness. Backgrounds stay mostly off/transparent; foreground elements carry color, contrast, and warmth against that white.
- **Calm premium motion:** smooth, understated, luxury-retail animation — never gamified, never cartoonish.

## 2. Design Principles

- **Voice-first, screen-second.** The primary input is speech; every screen must read clearly even to someone who glances at it only occasionally while talking.
- **One thing at a time.** Idle shows ads + avatar. Conversation shows avatar + transcript option. Showcase shows products + a smaller avatar. Never all of these competing for attention simultaneously at full weight.
- **Portrait-native, not portrait-adapted.** Layouts are designed for a tall, narrow canvas from the start — not a landscape design rotated 90°.
- **Never fabricate presence.** The avatar should never appear frozen, teleport between states, or vanish — every transition is animated and every state has a visible "alive" cue (breathing, blinking, listening glow).

## 3. User Experience Goals

- A first-time visitor understands within 2 seconds that they can simply talk to the display.
- The transition from "asking about a product" to "seeing that product" feels like a single continuous gesture, not a page navigation.
- A visitor can always tell, at a glance, whether Nova is listening, thinking, or talking.
- Ending the interaction is obvious and immediate — no hunting for a way out.

## 4. Information Architecture

```
Aurora Display (single screen, state-driven, portrait)
├── Idle / Advertisement Mode (default)
└── Conversation Mode
    ├── Talking (avatar large, no products)
    ├── Product Showcase (avatar shrunk, product grid hero)
    └── Product Detail (avatar shrunk, single product hero)
Persistent overlays (present across all Conversation states):
├── Transcript strip (bottom, toggleable)
└── Voice Controls (floating mic + End Conversation)
```

There is no navigation menu. The visitor never taps between "pages" — every transition is state-driven by voice.

## 5. Wireframes (Textual)

**Idle Mode:** Nova centered, large, roughly the vertical middle-to-upper portion of the panel. Advertisement content plays behind/around her at reduced visual weight so she stays legible. A short welcome line sits just above her. No transcript, no voice controls emphasized (mic may be present but subtle).

**Conversation (Talking), no product yet:** Same avatar position and scale as Idle, ads paused/hidden, a small caption of Nova's current line may appear near her. Transcript toggle available at the very bottom edge.

**Product Showcase:** Nova shrinks and relocates to a lower corner or side edge (not top, to respect portrait reading order — products should occupy the upper/central "prime" real estate a visitor's eyes land on first). Product cards fill the vacated space in a vertically-friendly grid (2 columns is typical for portrait; never a single wide horizontal row that wastes portrait height).

**Product Detail:** Nova stays in the same shrunk position as Showcase (no additional relocate). The selected product's large image, name, price, and description occupy the freed space, stacked vertically to suit the portrait canvas.

**Advertisement Mode (return to idle):** Reverse of the showcase transition — products fade, Nova animates back to her large centered idle scale and position, ads resume.

## 6. Screen-by-Screen Layout

| Screen | Avatar | Primary content | Transcript | Voice controls |
|---|---|---|---|---|
| Idle / Advertisement | Large, centered | Rotating ad media | Hidden | Subtle/minimal |
| Conversation (Talking) | Large, centered | Optional speech caption | Available via toggle | Mic + End Conversation visible |
| Product Showcase | Small, corner/edge | Product grid (image/name/price) | Available via toggle | Mic + End Conversation visible |
| Product Detail | Small, corner/edge | Single product deep-dive | Available via toggle | Mic + End Conversation visible |

## 7. Navigation

There is no back button in the traditional sense for voice interaction — visitors navigate by speaking ("show me headphones instead," "go back," "that's all"). A minimal, secondary tap-to-go-back affordance may exist on Product Detail purely as a fallback for visitors who prefer touch, but voice is the primary and demonstrated path.

## 8. Avatar Behaviour

Nova supports four animation states, each visually distinct without relying on text labels alone:

- **Idle:** slow, continuous "breathing" (subtle scale/opacity shift) and periodic blinking — communicates "alive," never fully static.
- **Listening:** a visible glow/pulse ring activates the moment speech is detected — this is the platform's core trust signal ("I know you're speaking to me").
- **Thinking:** a distinct, understated processing cue (soft rotating glow, gentle glance) — never a generic spinner.
- **Talking:** restrained mouth/gesture motion synced loosely to speech cadence; avoid exaggerated repetitive gestures.

Nova's scale and position change only between two states: **large/centered** (Idle, Talking-without-products) and **small/corner** (Showcase, Detail). She never disappears entirely during an active session — only the Idle↔Advertisement transition may briefly reduce her prominence, never remove her.

## 9. Product Page Behaviour

- Showcase cards: image (largest visual weight), name (single line, truncate if needed), price (secondary but legible) — nothing else, per the MVP's deliberately minimal card content.
- Cards animate in staggered (not simultaneous) for a "being presented" feel rather than a UI dump.
- Selecting a card is a single tap/click (touch fallback) or a spoken reference ("tell me about the second one," "the Aria 14") — both must resolve to the same Product Detail transition.
- Detail view keeps the avatar narrating; the description text should appear roughly in sync with Nova's spoken explanation, not instantly before she starts talking.

## 10. Motion Design

- All state transitions use smooth cross-fades or eased slides (200–400ms), never hard cuts.
- The avatar's large↔small transition is the platform's signature motion — it must feel like one continuous, physically plausible movement (a spring/ease curve, not a linear resize), since this is the moment stakeholders will remember from the demo.
- A single shared easing curve and duration scale is used platform-wide for consistency.

## 11. Animation Guidelines

- Idle animation amplitude stays small — this is a premium showroom, not a mascot.
- Thinking and Listening cues must be visually distinguishable from each other at a glance (different color temperature or motion pattern, not just a shared generic "busy" look).
- Advertisement-to-conversation and conversation-to-advertisement transitions use one consistent treatment each time, so a returning visitor subconsciously recognizes "it's listening now."

## 12. Spacing System

A relative, percentage-based spacing system (not fixed pixels) so the same layout logic holds across panel sizes:

- Safe margin: minimum 5% of panel height/width from all edges for any critical content.
- Avatar zone: roughly the upper-to-middle 45–55% of vertical space in Idle/Talking; shrinks to a compact footprint (roughly 12–15% of panel height) in Showcase/Detail.
- Transcript zone: bottom 12–18% of vertical space when expanded; collapses to near-zero when toggled off.
- Voice controls: fixed-size floating elements anchored to a side edge, sized for comfortable touch fallback and clear visibility, never overlapping the transcript toggle or avatar's compact position (a layout collision explicitly to avoid — verify at implementation time that the shrunk avatar's corner and any floating control's corner are never the same corner).

## 13. Typography

- A clean, modern, humanist sans-serif, sized for typical showroom viewing distance (several feet) — err larger than standard desktop/mobile conventions.
- Hierarchy: welcome/greeting text largest and lightest weight; product name medium-large, bolder than body; price visually distinct (color or weight) but secondary to name; transcript text smallest, highest-legibility weight, generous line height.

## 14. Color Palette

**This is the section most affected by the confirmed hardware.** Because off-pixels reveal a **white** hollow interior, not a black void, the palette inverts the "true-black-for-transparency" convention used in generic transparent-OLED guidance:

- **Base/reveal:** true black in the UI = physically white in the installation. Treat black as "the gallery wall," not "the void."
- **Foreground content** (avatar, text, cards, controls) must carry enough color saturation or tonal depth to read clearly against a white reveal — pale, low-saturation, or pure-white UI elements will visually disappear into the cabinet's white interior and must be avoided.
- **Avatar rendering:** Nova's asset should be lit/color-graded assuming a bright white surround, not a dark stage — this is a real production note for whoever builds or licenses the avatar asset.
- **Accent color:** one configurable brand accent (future: per-tenant), used sparingly for the listening/thinking cues and price emphasis, chosen with strong contrast against white — mid-to-deep saturated tones (not pastels).
- **Avoid:** large fields of near-white or pale neutral UI chrome, and any design assumption inherited from dark-room transparent-OLED demos (glowing text on black) — that treatment is wrong for this specific white-cabinet hardware.

## 15. Icons

Minimal, single-weight line icons: microphone/listening state, End Conversation, transcript toggle. Listening/thinking states are communicated primarily through the avatar's own animated cues (Section 8), not through separate spinner icons, to avoid duplicated/competing "busy" signals.

## 16. Buttons

- **Microphone button:** floating, fixed to a side edge, always present during Conversation/Showcase/Detail states; visually indicates active listening (e.g., a pulse) when engaged.
- **End Conversation button:** floating, clearly distinct from the mic button (different shape/color weight, not just proximity), always reachable from any non-idle state, single tap/click returns to Idle per the flow in the SRS.
- **Transcript toggle:** small, unobtrusive, bottom edge, simple ON/OFF state with a smooth height-collapse transition on the panel it controls.
- All buttons sized for comfortable interaction as a touch fallback, even though voice is the primary path.

## 17. Transcript Design

- Position: bottom edge only, never anywhere else on screen.
- Style: translucent scrim behind small, legible text; minimal, alternating subtle treatment for visitor vs. Nova lines.
- Default: **hidden.** Purpose is speech-recognition verification, not a primary reading surface — this is an explicit product decision, not an oversight, so resist the temptation to make it more prominent "for clarity."
- Behavior: auto-scrolls to the latest line; toggling collapses/expands with a smooth height transition rather than an abrupt show/hide.

## 18. Voice Controls

- The floating mic button is the visible affordance that voice input is always available, even though speech can also be detected passively without pressing it (per the SRS's Advertisement Flow, speech alone interrupts Idle).
- Pressing the mic is a fallback/confidence affordance for visitors who aren't sure the system is listening — it should never be required to start a conversation.
- End Conversation is the only way to deliberately reset the session; it must never be hidden behind a menu or secondary gesture.

## 19. Advertisement Design

- Full-bleed promotional content (images/video/banners) during Idle, at reduced contrast/weight relative to where the avatar sits, so Nova stays legible on top of it.
- Content rotates on a fixed interval; rotation pauses immediately and unconditionally the instant speech is detected — no fade-out delay that would feel like the system "didn't hear."
- No transcript, no prominent voice-control emphasis during pure Idle — those affordances become visually meaningful once a conversation actually starts.

## 20. Responsive Considerations

- Primary target is the vertical transparent OLED panel; layout percentages (Section 12) are relative, not fixed pixel values, so the same logic scales across panel sizes within the vertical-portrait family.
- A standard monitor may be used to simulate the experience during development — when doing so, constrain the browser viewport to the target's portrait aspect ratio rather than testing in landscape, since a landscape preview will mislead every layout decision.

## 21. Transparent OLED Guidelines

- Reference hardware: vertical, portrait-orientation transparent OLED, mounted in a **white** cabinet with a **white hollow interior** behind the panel.
- Design implication (restated from Section 14 because it's easy to default back to old habits): off-pixels are not "invisible" in a neutral sense — they actively reveal white. Every screen should be evaluated by asking "what does this look like with every black/transparent pixel replaced by a white surface?"
- Legibility must hold at typical showroom viewing distance and typical showroom ambient lighting (which will generally be brighter than a dark-room OLED demo, given the white cabinet context) — favor higher-contrast, higher-saturation choices over subtle low-contrast ones.

## 22. Accessibility

- All spoken avatar output is mirrored in the transcript (even while hidden by default, it remains available on toggle) — supporting visitors who are hard of hearing or in a noisy environment.
- The listening indicator must be unambiguous, supporting both usability and privacy trust (a visitor should always be able to tell when audio is being captured).
- Text sizing calibrated for showroom viewing distance, not screen-adjacent reading distance.
- Motion stays subtle in amplitude — no rapid flashing or high-frequency motion patterns.
- Touch fallbacks (mic button, End Conversation, product card selection, transcript toggle) ensure the experience isn't voice-only-or-nothing for visitors who can't or prefer not to speak aloud.

## 23. Micro-interactions

- Listening pulse: a gentle, rhythmic glow the instant speech begins.
- Thinking cue: a distinct, calm processing motion, visually different from the listening pulse.
- Card entrance cascade: staggered fade/slide as Showcase populates, reinforcing "being presented" rather than "page loaded."
- Transcript toggle: icon state change paired with the smooth height-collapse of the panel beneath it.
- Avatar resize (large↔small): a single continuous spring motion, never a jump-cut, since this is the platform's signature interaction.

## 24. Design Tokens

*(Directional — final values to be confirmed once the reference hardware's actual peak brightness and viewing environment are measured on-site.)*

```
color.reveal.base:        #000000   /* renders as physical white on target hardware */
color.accent.primary:     <brand-configurable, deep-saturated>
color.text.primary:       <high-contrast against white reveal>
color.text.secondary:     <medium-contrast against white reveal>
spacing.safeMargin:       5%   /* of panel dimension */
spacing.avatarZone.large: 45–55%  /* vertical, Idle/Talking */
spacing.avatarZone.small: 12–15%  /* vertical, Showcase/Detail */
spacing.transcriptZone:   12–18%  /* vertical, when expanded */
motion.duration.short:    200ms
motion.duration.standard: 300ms
motion.duration.long:     400ms
motion.easing.standard:   ease-in-out
motion.avatarResize:      spring (not linear)
```

## 25. Future Improvements

- Per-tenant brand accent color and avatar appearance, driven by the future Avatar Creation Studio.
- On-site calibration pass for actual cabinet lighting/brightness once real hardware is available, refining Section 24's directional tokens into confirmed values.
- Multi-language typography and layout considerations once the future platform supports non-English avatars.
- Camera-based (privacy-conscious) presence detection to trigger Idle→Conversation transitions proactively, rather than relying on speech-only detection.
