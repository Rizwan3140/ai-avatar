# Product Requirements Document (PRD)

## Aurora — AI Avatar Builder Platform for Transparent OLED Displays

**Version:** 2.0
**Status:** Draft for Approval
**Supersedes:** `01-PRD.docx` (v1.0) — this version reframes the product around a clearly scoped MVP (one hardcoded avatar) sitting inside a much larger future platform (an avatar builder), and reflects the confirmed reference hardware (vertical transparent OLED, white cabinet, white hollow interior, voice-first).
**Document Owner:** Product Management

---

## 1. Executive Summary

Aurora is an AI Avatar Builder Platform that lets businesses deploy realistic, voice-first AI Digital Humans inside vertical Transparent OLED displays as showroom representatives. A customer walks up to the display, speaks naturally, and a photorealistic avatar answers questions, explains products, and — when asked — gracefully steps aside so the products themselves become the visual hero.

Aurora is being built in two clearly separated horizons:

- **Version 0.1 (MVP)** — a single, hardcoded avatar ("Nova") demonstrating the full experience end-to-end against a local mock product catalog, built to validate the vision with stakeholders before any platform investment.
- **The Future Platform** — a multi-tenant Avatar Creation Studio where any business can configure its own avatar, connect its own website, and have its own knowledge base — described in this document's roadmap section but explicitly **not** part of Version 0.1.

This document defines requirements for both horizons, but the MVP section is the one intended for immediate development sign-off.

## 2. Vision

To make every premium retail, showroom, or reception space able to greet visitors with an always-available, knowledgeable, human-feeling AI representative — one that lives inside a transparent OLED display, needs no human staffing, and can be stood up for any brand in minutes rather than months, without ever fabricating information about that brand's products.

## 3. Problem Statement

Physical retail and showroom spaces face a structural gap between two unsatisfying options:

- **Human staff** are costly, inconsistent across shifts, and unavailable at every moment a visitor has a question.
- **Static digital signage** looks premium but is one-directional — it cannot answer "does this laptop have enough battery for a full flight?" or "what's the difference between these two models?"

Conversational kiosks exist, but they read as generic chatbots bolted onto a screen: text-box UIs, no presence, no sense that "someone" is there. None are designed around the specific physical and visual constraints of a **vertical transparent OLED panel mounted in a white cabinet** — a fundamentally different canvas from a normal monitor, where "black" is invisible and reveals a physical white interior rather than arbitrary background.

There is no turnkey product today that lets a business point at its own catalog and get back a branded, voice-first, photorealistic digital human, purpose-built for this hardware.

## 4. Business Goals

- Prove, with a working MVP, that a voice-first digital human meaningfully outperforms static signage and text chatbots for showroom engagement.
- Establish Aurora as a platform, not a one-off build — every MVP decision should be defensible against "how does this generalize to the next customer's avatar?"
- Keep MVP cost and timeline minimal (mock data, one avatar, one LLM) so stakeholder approval and platform investment decisions can happen on real, demoed behavior rather than slideware.
- Lay an architectural foundation (LLM abstraction, modular state machine, componentized UI) that the future Avatar Creation Studio can be built on without a rewrite.

## 5. Objectives

1. Ship a working MVP demonstrating the full Idle → Conversation → Product Showcase → Idle loop on real target hardware (or an accurate simulation of it).
2. Validate that natural speech, routed through Claude, produces showroom-appropriate answers that stay on-catalog and in-persona.
3. Validate the "avatar shrinks, product becomes hero" transition as the signature interaction, since it is the platform's key differentiator against both chatbots and static signage.
4. Produce design documentation (this PRD, the SRS, and the UI/UX Spec) detailed enough for a development team to build Version 0.1 without further discovery, and for the future roadmap to be scoped credibly later.

## 6. Target Audience

**Primary buyers (B2B):**
- Retail chains (electronics, fashion, lifestyle)
- Luxury and premium showroom operators
- Experience centers (automotive, consumer electronics)
- Museums and exhibition organizers
- Corporate reception / brand experience teams

**End users (in front of the display):**
- Walk-in retail customers
- Showroom visitors and prospective buyers
- Museum and exhibition attendees
- Office visitors and guests

## 7. Personas

**7.1 Priya — Retail Operations Lead (future-platform buyer)**
Evaluates Aurora for her chain's flagship stores. Needs to see the MVP work convincingly before she'll sponsor the investment in the full builder platform. Cares about brand consistency and staff-hour reduction.

**7.2 Arjun — Showroom Customer (MVP end user)**
Walks up to the display, asks "show me laptops" or "which one is better for travel," expects a fast, human-feeling, accurate spoken answer, and wants to see the products, not read a paragraph.

**7.3 Meera — Brand/Marketing Owner (future-platform buyer)**
Cares that the avatar's look, voice, and greeting reflect her brand. In the MVP she has no configuration control — she is a stakeholder watching the demo, not a user of it.

**7.4 Karthik — Deployment/Hardware Engineer**
Responsible for the physical transparent OLED unit, its white cabinet, and making sure the MVP software runs reliably on-site. In V0.1 this may just be a laptop connected to the panel for the demo, not a hardened install.

## 8. User Journey (MVP)

```
Visitor approaches display
        ↓
Idle Mode: avatar large, advertisements rotating, welcome message
        ↓
Visitor speaks → advertisements stop instantly
        ↓
Avatar: Listening
        ↓
Avatar: Thinking
        ↓
Avatar: Talking (responds — greeting, small talk, or product question)
        ↓
If product-related: avatar shrinks and moves aside, Product Showcase fills the display
        ↓
Visitor selects a product → Product Detail (avatar still visible, still narrating)
        ↓
Visitor says "goodbye" / presses End Conversation
        ↓
Conversation clears, avatar enlarges, Advertisement Mode resumes
```

## 9. User Stories

- As a visitor, I want to speak naturally and be understood, so I don't have to learn a command syntax.
- As a visitor, I want the avatar to show me products visually when I ask about them, so I don't have to listen to a spoken list.
- As a visitor, I want to ask a follow-up like "which one has better battery life?" and have it understood in context, so I don't have to repeat myself.
- As a visitor, I want the avatar to politely decline unrelated requests (e.g., "write me a poem"), so the experience stays on-brand and trustworthy.
- As a visitor, I want a clear "End Conversation" option, so I can leave the interaction cleanly without waiting for a timeout.
- As a stakeholder, I want to see the full idle → conversation → product → idle loop working live, so I can approve investment in the full platform.
- As a stakeholder, I want the transcript available on demand, so I can verify the speech recognition is accurate during the demo.

## 10. Functional Requirements (Summary)

Full functional requirements are in the SRS. Summary of MVP-scoped capability:

- Single hardcoded photorealistic avatar with Idle / Listening / Thinking / Talking states.
- Functional speech recognition (STT) driving all conversational input.
- Claude as the sole LLM, prompted to behave as a showroom assistant, grounded strictly in the mock product catalog.
- Local mock product data (~10–15 products: image, name, price, description, category).
- Product Showcase transition (avatar shrinks/relocates, product grid becomes primary).
- Product Detail view (large image, name, price, description).
- Bottom-only, translucent, toggleable chat transcript for speech verification.
- Floating microphone control and an explicit End Conversation control.
- Advertisement Mode with rotating images/video/banners, interrupted instantly by speech.

## 11. Non-Functional Requirements

- **Performance:** voice round-trip (end of speech → start of avatar response) must feel conversational; no perceptible dead air.
- **Reliability:** the demo must recover gracefully from a failed STT capture or a Claude API error without a frozen or blank avatar.
- **Usability:** legible and operable at typical showroom viewing/speaking distance, in portrait orientation.
- **Maintainability:** Claude access must sit behind a service abstraction so a future provider or model could be substituted without touching calling code.
- **Accuracy:** the avatar must never state a product exists, or state a price/spec, that is not present in the mock catalog.
- **Portability:** the MVP should run against the real transparent OLED hardware or a standard monitor simulating its portrait aspect ratio, without code changes.

## 12. Feature Breakdown — Version 0.1 vs. Future

| Feature | V0.1 (MVP) | Future Platform |
|---|---|---|
| Avatar | One hardcoded, realistic | Studio-created, per-company |
| Avatar management | None | Full CRUD, multi-avatar |
| Product data | Local mock JSON | Website-crawled, auto-extracted |
| Knowledge grounding | Mock catalog only | Catalog + indexed site content |
| LLM | Claude only | Claude only, abstracted for future providers |
| Speech recognition | Functional STT | Same, tuned per deployment |
| Text-to-speech | Out of MVP scope (see Constraints) | Full voice profile per avatar |
| Transcript | Bottom strip, toggleable | Same, plus session history/analytics |
| Advertisement content | Local mock images/video | Managed media library per tenant |
| Multi-tenant | No | Yes |
| Admin dashboard | No | Yes |
| Authentication | No | Yes, role-based |
| Analytics | No | Yes |
| Languages | Single (English) | Multi-language per avatar |

## 13. Version 0.1 Scope (Explicit)

**In scope:** one hardcoded avatar; functional STT; Claude-only conversation grounded in a mock catalog; product showcase/detail views; bottom transcript with toggle; floating mic + End Conversation controls; advertisement mode; the six-state UI loop (Idle/Listening/Thinking/Talking/Showcase/Detail).

**Explicitly out of scope:** avatar creation/management, multiple avatars, website crawling, CSV generation, any backend database, multi-tenant support, authentication, admin dashboard, analytics, multi-language, cloud deployment, CMS, product recommendation/comparison engines. If a stakeholder asks for any of these during the MVP demo, the answer is "future platform" — not a scope addition.

## 14. Future Roadmap

1. **Avatar Creation Studio** — company name/logo, avatar name, gender, voice, appearance, clothing, personality, greeting script, brand colors, supported languages, connected website URLs, and knowledge sources, all configurable per tenant.
2. **Website Indexing** — submit one or more URLs; the platform crawls, classifies, and indexes product pages, FAQs, documentation, and support content.
3. **Product Extraction** — automatic generation of a structured product dataset from indexed pages, replacing the MVP's hand-written mock JSON.
4. **Company Knowledge Grounding** — retrieval-augmented answers sourced only from a company's own indexed data; the "never invent a product" rule from the MVP persists and hardens into a platform-wide guarantee.
5. **Platform integrations** — vector database for semantic retrieval, product recommendation and comparison engines, an admin dashboard, session/usage analytics, multi-tenant isolation, multi-language avatars, authentication and role-based access, cloud deployment, and CMS-style media management for advertisements.

## 15. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Speech recognition misfires in a noisy showroom environment | High | Tune STT sensitivity during hardware testing; visible listening indicator so users know when to speak |
| Claude produces an answer not grounded in the mock catalog | High | Strict system-prompt grounding rules; explicit "not available" fallback behavior |
| Avatar realism reads as uncanny rather than premium | Medium | Early stakeholder review of avatar asset before build-out continues |
| Transparent OLED's white-reveal behavior isn't accounted for in UI colors | Medium | UI/UX Spec explicitly designs for a white reveal, not a black void (see Document 3) |
| Stakeholders conflate MVP scope with full platform scope during the demo | Medium | This PRD's explicit V0.1/Future split; demo framing sets expectations up front |
| Voice latency breaks the "human" feel | Medium | Streaming responses where possible; latency budget tracked per pipeline stage |

## 16. Success Metrics

- The MVP completes the full Idle → Conversation → Product Showcase → Idle loop live, without a crash, in a stakeholder demo.
- Speech recognition correctly captures a representative sample of showroom-style questions (qualitative pass/fail during demo rehearsal).
- Claude's responses stay within the mock catalog with zero fabricated products/prices during a scripted demo run-through.
- Stakeholder sign-off to proceed with the Future Platform roadmap.

## 17. Business Value

The MVP is a low-cost, low-risk proof point: no backend, no database, no multi-tenant infrastructure, and a single avatar — but if it lands, it justifies the far larger investment in the Avatar Creation Studio and website-indexing pipeline, which is where Aurora's actual commercial value (a repeatable, multi-tenant SaaS platform) lives. The MVP's job is to de-risk that investment decision, not to be commercially deployed itself.

## 18. Assumptions

- Claude API access and quota are available for the demo environment.
- The target hardware (or an accurate portrait-orientation simulation of it) is available for testing before stakeholder demos.
- A microphone with reasonable noise rejection is available at the demo site.
- Stakeholders reviewing the MVP understand it is a scoped demonstration, not a shippable product.

## 19. Constraints

- V0.1 uses Claude exclusively — no other LLM provider.
- Product data is local mock JSON — no live catalog, no database, no backend service.
- One avatar only; no creation or configuration UI.
- Text-to-speech/voice output is **not required** for MVP sign-off; if time permits it may be added, but the MVP is validated primarily on STT accuracy, Claude's grounded responses, and the visual transition choreography. (If your team intends voice **output** as a hard MVP requirement, flag this explicitly — the section 2/10 spec provided emphasizes recognition and transcript verification over confirmed TTS behavior, so this document treats TTS as a stretch goal rather than a committed requirement.)
- Target hardware is a vertical, portrait-orientation transparent OLED panel in a white cabinet with a white hollow interior — not a desktop monitor, and not a landscape/horizontal panel.

## 20. Glossary

| Term | Definition |
|---|---|
| Aurora | The overall AI Avatar Builder Platform (future state) |
| Nova | The MVP's single hardcoded avatar persona |
| Digital Human | A realistic, non-cartoon AI avatar representing the brand |
| MVP / V0.1 | The scoped first version described in this document |
| Idle Mode | Default state; advertisements rotate, avatar large |
| Advertisement Mode | Synonym for Idle Mode's promotional content behavior |
| Product Showcase | State where products become the visual focus and avatar shrinks |
| Product Detail | Single-product deep-dive view |
| STT | Speech-to-Text, the speech recognition pipeline |
| LLM | Large Language Model (Claude, in this platform) |
| Transcript | Bottom-of-screen text log of the spoken conversation |
| Transparent OLED | The display technology; off/black pixels are see-through |
| Cabinet | The physical housing behind/around the OLED panel |
| Hollow Interior | The white, empty space behind the panel that shows through transparent pixels |
| Avatar Creation Studio | Future-platform tool for configuring a company's own avatar |
| Website Indexing | Future-platform crawling/extraction pipeline for a company's own data |
| Tenant | A company using the platform, in the future multi-tenant model |
