# Persistent Debug Log — Design

**Date:** 2026-07-06
**Status:** Approved (user: "yes")

## Problem

A queue run marked every item `not_found`, and the extension threw away
the evidence needed to tell why: the content script reports `not_found`
when zero search results match its selector, but records nothing about
what page it landed on or what was there. Console logging exists
(`[wf-cart:bg]` / `[wf-cart:cs]`) but lives in two consoles the user has
to hunt for. The user wants logs they can copy and paste when reporting
issues.

## Decision

1. **Service-worker-owned debug ring buffer** under a new
   `chrome.storage.local` key `debugLog`, capped at 200 entries (oldest
   dropped). Appended only by the worker inside its existing mutation
   lock, preserving the single-writer architecture. Entry shape:
   `{t: ISO timestamp, event, ...details}`. Events:
   - `message` — one per handled runtime message: type, sender tab id,
     index/status/url when present, and a summary of the response
     (`action`/`reason`/`granted`/`ok`/`paused`).
   - `navigate` — every queue-tab navigation: tabId, url, and
     `recreatedTab: true` when the tab had to be recreated.
   - `recorded` — every result recorded: index, status, reason (if any),
     nextIndex.
2. **Content script forwards diagnostics in its existing messages** (no
   new message type). When a search page yields zero matching results,
   the `not_found` report's `extra` gains a `diagnostics` object:
   landed `url`, `pageTitle`, and `selectorCounts` for three probes
   (`[data-component-type="s-search-result"]`, `[data-asin]`,
   `.s-result-item`) — enough to distinguish redirect vs. markup drift
   vs. rendered-too-slowly.
3. **Popup "Copy debug log" button** in the utility section: reads
   `debugLog` + the current `cartQueue` and copies a formatted text blob
   (one line per entry, then a pretty-printed queue snapshot, which is
   where per-item `diagnostics` live) to the clipboard via
   `navigator.clipboard.writeText` (inside the click gesture, so no new
   permission). Shows "Copied N log entries + queue snapshot." on
   success.
4. **Popup shows failure reasons inline** on `not_found` rows: "page
   mismatch — landed on <url>", "0 matching results at <url>", or "item
   had no name".
5. **Clear extension data** also removes `debugLog`.
6. Manifest version bump to **0.3.1** (no permission changes) so the
   loaded build is identifiable.

## Accepted trade-offs

- The popup's clear button removes `debugLog` directly (not via the
  worker). A clear racing a concurrent append can lose one entry or the
  clear — inconsequential for a diagnostic buffer.
- Two extra storage round-trips per handled message (log read+write).
  Trivial at this scale.

## Components

| Unit | Change |
|------|--------|
| `extension/background.js` | `DEBUG_LOG_KEY`/`DEBUG_LOG_MAX`, `logEvent()`, `summarizeResponse()`; dispatcher logs each handled message; `navigateQueueTab` and `recordAndAdvance` log their events (awaited, so lock ordering holds). |
| `extension/background.test.js` | Tests: message logged with response summary; ring cap at 200 drops oldest; reportResult produces `recorded` + `navigate` + `message` entries in order. |
| `extension/content-scripts/amazon-cart.js` | Zero-results branch reports `diagnostics` extra. |
| `extension/content-scripts/amazon-cart.test.js` | not_found test also asserts diagnostics url + selectorCounts. |
| `extension/popup.html` / `popup.js` / `popup.css` | Copy button + status line, inline not-found detail, `debugLog` added to clear, small `.status-detail` style. |
| `extension/manifest.json` | Version 0.3.1 only. |
| `extension/README.md` | Update diagnostics bullet: copy button instead of console-hunting. |

## Testing

Worker log behavior and CS diagnostics are unit-tested (existing fakes).
Popup stays under the existing convention (script-scope smoke test guards
load-time collisions — any new top-level identifiers must not collide
with lib globals). Live check: run a queue, click Copy debug log, paste.
