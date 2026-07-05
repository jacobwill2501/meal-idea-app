// Reads the grocery-export-data element from the meal-idea-app page and
// mirrors its JSON into chrome.storage.local so the popup can read it.
// The app re-renders this element live as the user edits their list, so we
// keep watching it with a MutationObserver rather than reading it once.

const EXPORT_ELEMENT_ID = 'grocery-export-data';
const STORAGE_KEY = 'groceryExport';

function readExportData() {
  const el = document.getElementById(EXPORT_ELEMENT_ID);
  if (!el) {
    // Element may not exist yet (app still mounting) or may have been
    // removed. Nothing to do until it shows up.
    return;
  }

  let data;
  try {
    data = JSON.parse(el.textContent);
  } catch (err) {
    // Content may be transiently invalid mid-render (e.g. React swapping
    // the textContent in two steps). Log and skip; the next mutation will
    // give us another chance.
    console.warn('[grocery-export] failed to parse export JSON, skipping:', err);
    return;
  }

  chrome.storage.local.set({ [STORAGE_KEY]: data }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[grocery-export] failed to write to storage:', chrome.runtime.lastError);
    }
  });
}

function observeExportElement() {
  const el = document.getElementById(EXPORT_ELEMENT_ID);
  const target = el ? el.parentNode : document.documentElement;

  if (!target) {
    return;
  }

  const observer = new MutationObserver(() => {
    readExportData();
  });

  observer.observe(target, {
    childList: true,
    characterData: true,
    subtree: true,
  });
}

// Initial read on script load — the observer alone won't fire for content
// that's already present when this script starts running.
readExportData();
observeExportElement();
