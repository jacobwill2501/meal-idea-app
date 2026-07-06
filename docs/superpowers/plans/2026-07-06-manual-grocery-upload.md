# Manual Grocery Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace automatic grocery-list pickup with a manual "Upload grocery list" popup button that is visible only on meal-idea-app pages and enabled only while the app's Grocery List tab is active.

**Architecture:** Delete the `app-reader.js` content script and its manifest entry. The popup probes the active tab with `chrome.scripting.executeScript` using a self-contained reader function (`readGroceryExport` in `extension/lib/export-reader.js`); the same function runs again on click and its result is written to the existing `groceryExport` storage key, so all downstream popup rendering is unchanged. Spec: `docs/superpowers/specs/2026-07-06-manual-grocery-upload-design.md`.

**Tech Stack:** Chrome Extension MV3 (`scripting` permission, `tabs`), vanilla JS UMD-style globals, Jest 30 + jsdom (repo root config; run `npx jest <path>` from repo root).

## Global Constraints

- No new npm dependencies; no build step for the extension.
- Shared libs follow the `extension/lib/matcher.js` pattern: plain script, `module.exports` guard AND `globalThis.<name>` assignment.
- `readGroceryExport` MUST be closure-free (no references to popup globals) — `chrome.scripting.executeScript` serializes the function into the page.
- The only writers of the `groceryExport` storage key after this change: the upload button and the existing "Clear extension data" button.
- Tasks 1, 2, and 3 touch disjoint files and may be implemented in parallel; each task's implementer commits only their own files.

## File Map

| Action | File | Task |
|--------|------|------|
| Create | `extension/lib/export-reader.js` | 1 |
| Create | `extension/lib/export-reader.test.js` | 1 |
| Modify | `extension/manifest.json` | 2 |
| Delete | `extension/content-scripts/app-reader.js` | 2 |
| Modify | `extension/README.md` | 2 |
| Modify | `extension/popup.html` | 3 |
| Modify | `extension/popup.js` | 3 |

---

### Task 1: `readGroceryExport` reader lib

**Files:**
- Create: `extension/lib/export-reader.js`
- Test: `extension/lib/export-reader.test.js`

**Interfaces:**
- Consumes: nothing (pure DOM read of its executing document).
- Produces: global function `readGroceryExport(): {ok: true, data: object} | {ok: false, error: 'not-found' | 'invalid-json'}` — Task 3 passes it as the `func` argument to `chrome.scripting.executeScript`.

- [ ] **Step 1: Write the failing tests**

Create `extension/lib/export-reader.test.js`:

```js
/**
 * @jest-environment jsdom
 */

const { readGroceryExport } = require('./export-reader.js');

describe('readGroceryExport', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('returns the parsed export when the element holds valid JSON', () => {
    document.body.innerHTML =
      '<script type="application/json" id="grocery-export-data">' +
      '{"exportedAt":"2026-07-06T12:00:00.000Z","items":[{"name":"avocados","quantity":3}]}' +
      '</script>';
    const result = readGroceryExport();
    expect(result.ok).toBe(true);
    expect(result.data.items).toEqual([{ name: 'avocados', quantity: 3 }]);
  });

  test('reports not-found when the element is absent (grocery tab not open)', () => {
    expect(readGroceryExport()).toEqual({ ok: false, error: 'not-found' });
  });

  test('reports invalid-json when the element content is mid-render garbage', () => {
    document.body.innerHTML =
      '<script type="application/json" id="grocery-export-data">{"items":[</script>';
    expect(readGroceryExport()).toEqual({ ok: false, error: 'invalid-json' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest extension/lib/export-reader.test.js`
Expected: FAIL — `Cannot find module './export-reader.js'`

- [ ] **Step 3: Implement `extension/lib/export-reader.js`**

```js
// Reads the meal-idea-app's grocery export element out of the current
// document. This function is injected into the app page via
// chrome.scripting.executeScript, which serializes it — so it MUST stay
// closure-free: no references to anything defined outside its own body.
//
// The #grocery-export-data <script type="application/json"> element is
// rendered by the app's GroceryList component and exists only while the
// Grocery List tab is active, which is exactly what makes it a reliable
// "is the user on the grocery list page" probe for the popup.

function readGroceryExport() {
  const el = document.getElementById('grocery-export-data');
  if (!el) {
    return { ok: false, error: 'not-found' };
  }
  try {
    return { ok: true, data: JSON.parse(el.textContent) };
  } catch (err) {
    return { ok: false, error: 'invalid-json' };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { readGroceryExport };
}
if (typeof globalThis !== 'undefined') {
  globalThis.readGroceryExport = readGroceryExport;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest extension/lib/export-reader.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/lib/export-reader.js extension/lib/export-reader.test.js
git commit -m "feat: closure-free readGroceryExport reader for executeScript injection"
```

---

### Task 2: Remove automatic pickup (manifest, app-reader, README)

**Files:**
- Modify: `extension/manifest.json`
- Delete: `extension/content-scripts/app-reader.js`
- Modify: `extension/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the `"scripting"` permission Task 3's popup code relies on at runtime.

- [ ] **Step 1: Edit `extension/manifest.json`**

Three changes:

1. `"version": "0.2.0"` → `"version": "0.3.0"`.
2. `"permissions": ["storage", "tabs"]` → `"permissions": ["storage", "tabs", "scripting"]`.
3. Delete the app-pages content-script entry (the whole first object in `content_scripts`):

```json
    {
      "matches": [
        "https://jacobwill2501.github.io/meal-idea-app/*",
        "http://localhost:3000/*"
      ],
      "js": ["content-scripts/app-reader.js"],
      "run_at": "document_idle"
    },
```

so that `content_scripts` keeps ONLY the amazon.com entry. Do NOT touch `host_permissions` — the app origins listed there are what authorizes `chrome.scripting.executeScript` on app pages.

- [ ] **Step 2: Delete the content script**

```bash
git rm extension/content-scripts/app-reader.js
```

- [ ] **Step 3: Update `extension/README.md`**

Replace this bullet (under "## How it works"):

```markdown
- `content-scripts/app-reader.js` runs on the app's pages. It reads the
  hidden `#grocery-export-data` element, parses its JSON, and mirrors it
  into `chrome.storage.local` under `groceryExport`. A `MutationObserver`
  keeps this in sync live as you edit your list — no reload needed.
```

with:

```markdown
- Nothing runs on the app's pages automatically. The popup shows an
  **Upload grocery list** button whenever the active tab is the
  meal-idea-app; it is enabled only while the app's Grocery List tab is
  active (detected by probing for the `#grocery-export-data` element with
  `chrome.scripting.executeScript`). Clicking it reads that element's JSON
  and stores it in `chrome.storage.local` under `groceryExport`. Edit your
  list in the app, click upload again to refresh the copy.
```

And replace this line in the same section:

```markdown
- `popup.js` reads `groceryExport` from storage and renders it.
```

with:

```markdown
- `popup.js` reads `groceryExport` from storage and renders it; the
  stored copy only changes when you click **Upload grocery list** (or
  **Clear extension data**).
```

- [ ] **Step 4: Validate the manifest**

Run: `node -e "const m=JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); if(m.content_scripts.length!==1) throw new Error('expected 1 content_scripts entry'); if(!m.permissions.includes('scripting')) throw new Error('missing scripting'); console.log('manifest ok', m.version)"`
Expected: `manifest ok 0.3.0`

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/README.md
git rm --cached extension/content-scripts/app-reader.js 2>/dev/null; true
git commit -m "feat: drop automatic grocery pickup; scripting permission for manual upload"
```

(If Step 2's `git rm` already staged the deletion, the second line is a no-op.)

---

### Task 3: Popup upload button

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`

**Interfaces:**
- Consumes: global `readGroceryExport` from Task 1 (exact return shape listed there); `"scripting"` permission from Task 2 (runtime only — code compiles without it).
- Produces: user-facing feature; nothing downstream.

- [ ] **Step 1: Add the upload section to `extension/popup.html`**

Insert directly after the closing `</header>` tag (before the `empty-state` section):

```html
      <section id="upload-section" class="section" hidden>
        <button id="upload-btn" class="btn btn-primary" type="button" disabled>
          Upload grocery list
        </button>
        <p id="upload-error" class="hint" hidden></p>
        <p class="hint">
          Enabled while the app's Grocery List tab is open. Nothing is read
          automatically — click to (re)upload the current list.
        </p>
      </section>
```

And change the script block at the bottom from:

```html
    <script src="lib/matcher.js"></script>
    <script src="lib/urls.js"></script>
    <script src="popup.js"></script>
```

to:

```html
    <script src="lib/matcher.js"></script>
    <script src="lib/urls.js"></script>
    <script src="lib/export-reader.js"></script>
    <script src="popup.js"></script>
```

- [ ] **Step 2: Update the empty-state copy in `extension/popup.html`**

Replace:

```html
        <p>
          No grocery export found. Open your grocery list in the app tab and
          make sure at least one item is in it.
        </p>
```

with:

```html
        <p>
          No grocery list uploaded yet. Open the Grocery List tab in the
          meal-idea-app, then click "Upload grocery list" above.
        </p>
```

- [ ] **Step 3: Wire the button in `extension/popup.js`**

3a. Add element refs after the existing `const clearDataBtn = ...` line:

```js
const uploadSectionEl = document.getElementById('upload-section');
const uploadBtn = document.getElementById('upload-btn');
const uploadErrorEl = document.getElementById('upload-error');
```

3b. Add below the `sendCommand` function:

```js
const APP_URL_PREFIXES = [
  'https://jacobwill2501.github.io/meal-idea-app',
  'http://localhost:3000',
];

function getActiveAppTab(callback) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    const onApp = Boolean(
      tab && tab.url && APP_URL_PREFIXES.some((prefix) => tab.url.startsWith(prefix))
    );
    callback(onApp ? tab : null);
  });
}

// Runs readGroceryExport (from lib/export-reader.js) inside the app page.
// The function is serialized by executeScript, so it must stay closure-free.
function runReaderInTab(tabId, callback) {
  chrome.scripting.executeScript(
    { target: { tabId }, func: readGroceryExport },
    (results) => {
      if (chrome.runtime.lastError) {
        console.warn('[wf-cart:popup] executeScript failed:', chrome.runtime.lastError);
        callback(null);
        return;
      }
      callback(results && results[0] ? results[0].result : null);
    }
  );
}

// Section is visible only on app pages; the button is enabled only while
// the app's Grocery List tab is active (= the export element exists).
function probeUploadAvailability() {
  getActiveAppTab((tab) => {
    if (!tab) {
      uploadSectionEl.hidden = true;
      return;
    }
    uploadSectionEl.hidden = false;
    uploadBtn.disabled = true;
    runReaderInTab(tab.id, (result) => {
      uploadBtn.disabled = !(result && result.ok);
    });
  });
}

function uploadGroceryList() {
  uploadErrorEl.hidden = true;
  getActiveAppTab((tab) => {
    if (!tab) {
      uploadSectionEl.hidden = true;
      return;
    }
    runReaderInTab(tab.id, (result) => {
      if (!result || !result.ok) {
        uploadErrorEl.textContent =
          "Couldn't read the grocery list — make sure the Grocery List tab is open, then try again.";
        uploadErrorEl.hidden = false;
        return;
      }
      chrome.storage.local.set({ [EXPORT_KEY]: result.data });
      // storage.onChanged re-renders the export list from the new copy.
    });
  });
}
```

3c. Register the listener next to the other button listeners (after `queueToggleBtn.addEventListener(...)`):

```js
uploadBtn.addEventListener('click', uploadGroceryList);
```

3d. Kick off the probe with the other initial loads (at the very bottom, next to `loadExportData(); loadCartQueue();`):

```js
probeUploadAvailability();
```

- [ ] **Step 4: Syntax-check both files**

Run: `node --check extension/popup.js && echo popup ok`
Expected: `popup ok`

- [ ] **Step 5: Commit**

```bash
git add extension/popup.html extension/popup.js
git commit -m "feat: manual Upload grocery list button gated on the app's grocery tab"
```

---

### Task 4 (orchestrator): Integration verification

- [ ] **Step 1: Full test suite**

Run from repo root: `npx jest`
Expected: PASS, all suites (existing 96 + 3 new reader tests; count may exclude worktree duplicates depending on cwd).

- [ ] **Step 2: Manifest + syntax sweep**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('manifest ok')"
node --check extension/popup.js
node --check extension/lib/export-reader.js
test ! -f extension/content-scripts/app-reader.js && echo "app-reader gone"
grep -c "app-reader" extension/manifest.json || echo "no manifest references"
```
Expected: `manifest ok`, no syntax errors, `app-reader gone`, `no manifest references` (grep exits non-zero with 0 matches).
