# Test Execution Report

**Project:** Luxora — AI Digital Human for Transparent OLED Showroom Cabinets
**Report date:** 17 August 2026
**Prepared for:** design and engineering review

---

## 1. Testing objective

Establish a verified, reproducible automated baseline for Luxora, and state
precisely which behaviour is covered by that baseline and which is not.

The project's stated risk is not that code is missing but that some of it has
never been exercised outside a test. This report therefore separates four
states, and uses them consistently:

| State | Meaning |
|---|---|
| **Implemented** | Code exists and typechecks |
| **Tested** | Covered by an automated check in this report |
| **Manually validated** | A person drove it and observed the result |
| **Externally blocked** | Cannot proceed without hardware, a key, or a human |

## 2. Test environment

| | |
|---|---|
| OS | Windows 11 (26100), development machine |
| Python | 3.13, project virtualenv at `.venv/` |
| Node.js | 20+, npm workspace at `frontend/` |
| Backend | FastAPI + Uvicorn |
| Frontend | React 19, TypeScript 5.7, Vite 6 |
| Database | SQLite with FTS5 (stdlib `sqlite3`) |
| LLM | Ollama, `llama3.2:3b`, local |
| STT | faster-whisper `base.en`, local, CPU int8 |
| Test runners | `node --test`; plain assert scripts for Python |

**No test framework is used anywhere.** The Python suites are assert-based
scripts with a pass/fail counter, not `unittest.TestCase` classes.

> **Invocation matters.** Running these through `python -m unittest` reports
> *zero tests*, because there are no `TestCase` subclasses to discover. This is
> not a failure — it is the wrong runner. Always use the module invocation below.

## 3. Commands executed

```bash
# Frontend
cd frontend && npm test

# Backend — each is a module invocation, not a unittest discovery
python -m backend.test_catalog
python -m backend.test_platform
python -m backend.test_api
```

On the development machine the interpreter is the project virtualenv:

```bash
./.venv/Scripts/python.exe -m backend.test_catalog     # Windows
./.venv/bin/python -m backend.test_catalog             # macOS / Linux
```

## 4. Results

### 4.1 Frontend — `npm test`

```
ℹ tests 50
ℹ pass 50
ℹ fail 0
```

**50 passed, 0 failed, 0 errors.**

Covers the conversation state machine, session lifecycle, product navigation and
pronoun resolution, try-on voice intent, WAV encoding and RMS measurement, and
selection persistence.

### 4.2 Backend catalog — `python -m backend.test_catalog`

```
all checks passed
```

**27 passed, 0 failed, 0 errors.**

Covers catalog search and ranking, price-ceiling parsing from natural speech,
CSV ingestion quirks including unquoted commas, and the schema.org crawler.

### 4.3 Backend platform — `python -m backend.test_platform`

```
98 passed, 0 failed
```

**98 passed, 0 failed, 0 errors.**

Covers password hashing and verification, token issue/verify/tamper/expiry,
account and membership management, tenant isolation, document chunking and
retrieval, multi-format ingestion, try-on consent enforcement, garment source
resolution, and identifier safety.

### 4.4 Backend API — `python -m backend.test_api`

```
52 passed, 0 failed
```

**52 passed, 0 failed, 0 errors.**

Runs the real ASGI application through FastAPI's `TestClient`, exercising the
actual routes and their dependencies rather than the modules behind them.

## 5. Total verified baseline

| Suite | Checks |
|---|---|
| Frontend | 50 |
| Backend catalog | 27 |
| Backend platform | 98 |
| Backend API | 52 |
| **Total** | **227** |

**227 passed · 0 failed · 0 errors.**

### 5.1 Relationship to the previously reported figures

| Baseline | Total | Note |
|---|---|---|
| Pre-audit | 217 | Superseded |
| After Cline Phase 0 + Phase 1 | 221 | Superseded |
| **This report** | **227** | Current |

The increase from 221 to 227 is six regression checks added while completing
Phase 2 and the showcase work — four in `test_platform` and two in the frontend.
No check was removed, weakened or skipped. Every previously passing check still
passes.

## 6. Regression tests added

### 6.1 Added by Cline (Phase 0 / Phase 1)

| Check | Defect it guards |
|---|---|
| A boot error survives `SYSTEM_READY` | An offline kiosk appearing healthy because the readiness event cleared the error |
| Unknown avatar id does not resolve to another org's catalog | Cross-tenant catalog exposure when kiosk identity is unknown |
| Try-on analytics carry `org_id` | Try-on events landing in the wrong organisation's reporting |

### 6.2 Added during this pass

| Check | Defect it guards |
|---|---|
| A public garment URL is passed through untouched | Needless re-encoding of an already-reachable image |
| A data URI garment is passed through untouched | Same, for pre-inlined images |
| A traversing garment path is refused | `image: "../../.env"` in a customer catalog becoming a file-read primitive |
| A missing garment file is refused | Silent failure deep inside a provider call |
| Naming a product keeps it selected when its results arrive | Detail view opening and bouncing back to the grid |
| A selection no longer in the results is dropped | A stale product staying selected after a new search |

## 7. Limitations

These are the boundaries of what the 227 checks establish. Each is a real gap,
not a caveat.

### 7.1 The API suite runs in cloud role

`backend/test_api.py` sets `LUXORA_ROLE=cloud`, so the process loads no model.
This is deliberate — it keeps the suite fast and machine-independent, and it
verifies the edge/cloud split by confirming `/api/chat` is **absent** in cloud
role.

The consequence is that the **edge-only runtime paths are not covered by
automated tests**: `backend/stt.py` (faster-whisper) and `backend/llm.py`
(Ollama) are never loaded during the suite. Their behaviour has been exercised
manually (§8) but not automatically.

### 7.2 Microphone validation is not automated, and not complete

No automated check drives a real microphone. The audio path — AudioWorklet
capture, energy-based voice-activity detection, end-of-turn silence, echo
rejection and barge-in — is covered only at the level of pure functions (WAV
encoding, RMS) and state transitions.

The following require a person in a real room and remain **externally blocked**:

- `voiceThreshold` tuning against a real microphone's noise floor
- `bargeInThreshold` tuning against real speaker volume
- `endOfTurnSilence` against natural mid-sentence pauses
- End-to-end speech-to-speech latency
- Echo rejection with the avatar's own voice returning through the microphone

### 7.3 Try-on has never produced an image

The consent flow, camera capture, endpoint, refusal paths and garment resolution
are implemented and tested. Neither hosted provider has ever run, because both
require a paid API key (§ Document 4). No automated check can cover the actual
image generation.

### 7.4 Model quality is measured, not test-gated

The fabrication cases in §8.2 were measured by hand against the running model.
They are not automated checks, because the model is non-deterministic and a
flaky assertion in CI is worse than an honest measurement in a report.

### 7.5 Lip-sync is not implemented

The renderer seam exists on both sides with a single implementation (MP4
crossfade) behind it. There is nothing to test.

## 8. Manual validation performed

Recorded separately from the automated baseline because it was observed, not
asserted.

### 8.1 Application drive-through

Launched the real application (`LUXORA_ROLE=all`, Uvicorn on :8000, built
frontend) and drove it in Chromium at 1080×1920, 1440×820 and 1920×1080:

- Kiosk boots, resolves its identity, renders the avatar — **observed**
- Idle campaign playback with scheduled media and a spoken invitation — **observed**
- Campaign correctly hidden during conversation — **observed**
- Product grid on first turn, detail view with QR on the second — **observed**
- All six Studio screens render with zero console errors — **observed**
- Document upload, indexing and retrieval in conversation — **observed**
- Try-on button correctly absent when no provider is configured — **observed**

### 8.2 Fabrication measurement

Measured against `llama3.2:3b` through the real `/api/chat` endpoint.

| Case | Before | After |
|---|---|---|
| "How much is the Titan Pro" (₹1,899) | Answered ₹1,299 | **Correct** |
| "What is the price of the Aria 14" (₹1,299) | Answered ₹1,299 | **Correct** |
| "How much is the linen shirt" (₹2,499) | Answered ₹1,299 | **Correct** |
| "Do you sell washing machines" (not stocked) | Invented a range, 3 of 4 runs | **Refused, 4 of 4 runs** |

**Root cause of the price fabrication was a defect in the prompt, not the
model.** The persona contained a formatting example — `Use plain spoken numbers
— "twelve ninety-nine"` — and the 3B model copied that literal string as the
answer to every price question. Removing the copyable number corrected all three
price cases.

The invented-category case was corrected by rewriting the empty-catalog
instruction as explicit prohibitions rather than a policy statement.

Sample size is four runs per case. This is a measurement, not a guarantee.

## 9. Conclusion

The automated baseline is **227 passing checks with zero failures and zero
errors**, and it is reproducible with four commands.

That baseline covers the platform thoroughly — tenancy, accounts, catalog,
knowledge, ingestion, routing and state. It does not cover the microphone, the
hosted try-on providers, or model output quality, and this report does not claim
otherwise.

The largest outstanding risk is unchanged and remains **real-microphone
validation**, which needs a person rather than more code.
