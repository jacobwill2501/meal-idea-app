// Popup UI: reads the groceryExport mirrored by app-reader.js out of
// chrome.storage.local and offers "assisted mode" — opening a
// Whole-Foods-scoped Amazon search tab per item so the user can add each
// one to their cart manually. This is the reliable, scrape-free mode.

const EXPORT_KEY = 'groceryExport';
const CART_QUEUE_KEY = 'cartQueue';
const PINNED_KEY = 'pinnedProducts';
const AMAZON_MATCH_PATTERN = 'https://www.amazon.com/*';

const exportMetaEl = document.getElementById('export-meta');
const emptyStateEl = document.getElementById('empty-state');
const assistedModeEl = document.getElementById('assisted-mode');
const openAllBtn = document.getElementById('open-all-btn');
const itemListEl = document.getElementById('item-list');
const automatedModeEl = document.getElementById('automated-mode');
const sendToCartBtn = document.getElementById('send-to-cart-btn');
const cartQueueListEl = document.getElementById('cart-queue-list');

let latestExportData = null;

function wholeFoodsSearchUrl(itemName) {
  const query = encodeURIComponent(itemName);
  return `https://www.amazon.com/s?k=${query}&i=wholefoods`;
}

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return 'unknown time';
  }
  return date.toLocaleString();
}

function renderItems(items) {
  itemListEl.innerHTML = '';

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'item-row';

    const info = document.createElement('div');
    info.className = 'item-info';

    const nameEl = document.createElement('span');
    nameEl.className = 'item-name';
    nameEl.textContent = item.name;

    const qtyEl = document.createElement('span');
    qtyEl.className = 'item-qty';
    qtyEl.textContent = `Qty: ${item.quantity}`;

    info.appendChild(nameEl);
    info.appendChild(qtyEl);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'btn btn-secondary';
    openBtn.textContent = 'Open in Whole Foods';
    openBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: wholeFoodsSearchUrl(item.name), active: false });
    });

    li.appendChild(info);
    li.appendChild(openBtn);
    itemListEl.appendChild(li);
  });
}

function renderExport(exportData) {
  latestExportData = exportData;

  if (!exportData || !Array.isArray(exportData.items) || exportData.items.length === 0) {
    emptyStateEl.hidden = false;
    assistedModeEl.hidden = true;
    automatedModeEl.hidden = true;
    exportMetaEl.textContent = 'No export data yet.';
    return;
  }

  emptyStateEl.hidden = true;
  assistedModeEl.hidden = false;
  automatedModeEl.hidden = false;

  const { items, exportedAt } = exportData;
  const itemWord = items.length === 1 ? 'item' : 'items';
  exportMetaEl.textContent = `${items.length} ${itemWord} - exported ${formatTimestamp(exportedAt)}`;

  renderItems(items);
}

function statusLabel(status) {
  switch (status) {
    case 'added':
      return 'Added';
    case 'ambiguous':
      return 'Ambiguous';
    case 'not_found':
      return 'Not found';
    default:
      return 'Pending';
  }
}

function pinAndRerun(index, candidate) {
  chrome.storage.local.get([CART_QUEUE_KEY, PINNED_KEY], (result) => {
    const queue = result[CART_QUEUE_KEY];
    if (!queue || !Array.isArray(queue.items) || !queue.items[index]) {
      return;
    }
    const pinned = result[PINNED_KEY] || {};
    const key = GroceryMatcher.normalizeKey(queue.items[index].name);
    pinned[key] = {
      asin: candidate.asin,
      title: candidate.title || null,
      pinnedAt: new Date().toISOString(),
    };
    chrome.storage.local.set({ [PINNED_KEY]: pinned }, () => {
      retryItem(index);
    });
  });
}

function unpinItem(itemName) {
  chrome.storage.local.get(PINNED_KEY, (result) => {
    const pinned = result[PINNED_KEY] || {};
    delete pinned[GroceryMatcher.normalizeKey(itemName)];
    chrome.storage.local.set({ [PINNED_KEY]: pinned });
    // storage.onChanged re-renders the queue with the pin removed.
  });
}

function renderCandidatePicker(item, index, candidates) {
  const picker = document.createElement('ul');
  picker.className = 'candidate-list';

  candidates.forEach((candidate) => {
    const li = document.createElement('li');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate';
    btn.addEventListener('click', () => pinAndRerun(index, candidate));

    if (candidate.imageUrl) {
      const img = document.createElement('img');
      img.src = candidate.imageUrl;
      img.alt = '';
      btn.appendChild(img);
    }

    const label = document.createElement('span');
    label.className = 'candidate-title';
    label.textContent = candidate.title || candidate.asin;
    btn.appendChild(label);

    if (candidate.price) {
      const price = document.createElement('span');
      price.className = 'candidate-price';
      price.textContent = candidate.price;
      btn.appendChild(price);
    }

    li.appendChild(btn);
    picker.appendChild(li);
  });

  return picker;
}

function renderCartQueue(queue, pinned) {
  cartQueueListEl.innerHTML = '';

  if (!queue || !Array.isArray(queue.items)) {
    sendToCartBtn.disabled = false;
    return;
  }

  sendToCartBtn.disabled = false;

  const results = Array.isArray(queue.results) ? queue.results : [];

  queue.items.forEach((item, index) => {
    const result = results[index];
    const status = result ? result.status : 'pending';

    const li = document.createElement('li');
    li.className = 'item-row';

    const info = document.createElement('div');
    info.className = 'item-info';

    const nameEl = document.createElement('span');
    nameEl.className = 'item-name';
    nameEl.textContent = item.name;

    const qtyEl = document.createElement('span');
    qtyEl.className = 'item-qty';
    qtyEl.textContent = `Qty: ${item.quantity}`;

    info.appendChild(nameEl);
    info.appendChild(qtyEl);

    const pin = pinned[GroceryMatcher.normalizeKey(item.name)];
    if (pin) {
      const pinEl = document.createElement('span');
      pinEl.className = 'pin-indicator';
      pinEl.textContent = `\u{1F4CC} ${pin.title || pin.asin}`;

      const unpinBtn = document.createElement('button');
      unpinBtn.type = 'button';
      unpinBtn.className = 'btn-link';
      unpinBtn.textContent = 'Unpin';
      unpinBtn.addEventListener('click', () => unpinItem(item.name));
      pinEl.appendChild(unpinBtn);

      info.appendChild(pinEl);
    }

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const statusEl = document.createElement('span');
    statusEl.className = `item-status status-${status}`;
    statusEl.textContent = statusLabel(status);
    actions.appendChild(statusEl);

    if (status === 'ambiguous' || status === 'not_found') {
      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'btn btn-secondary btn-small';
      retryBtn.textContent = 'Retry';
      retryBtn.addEventListener('click', () => retryItem(index));
      actions.appendChild(retryBtn);

      const manualBtn = document.createElement('button');
      manualBtn.type = 'button';
      manualBtn.className = 'btn btn-secondary btn-small';
      manualBtn.textContent = 'Open manually';
      manualBtn.addEventListener('click', () => {
        chrome.tabs.create({ url: wholeFoodsSearchUrl(item.name), active: false });
      });
      actions.appendChild(manualBtn);
    }

    li.appendChild(info);
    li.appendChild(actions);

    if (status === 'ambiguous' && result && Array.isArray(result.candidates) && result.candidates.length > 0) {
      li.appendChild(renderCandidatePicker(item, index, result.candidates));
    }

    if (status === 'added' && result && Array.isArray(result.candidates) && result.candidates.length > 0) {
      const wrongBtn = document.createElement('button');
      wrongBtn.type = 'button';
      wrongBtn.className = 'btn-link';
      wrongBtn.textContent = 'Wrong item?';
      actions.appendChild(wrongBtn);

      const picker = renderCandidatePicker(item, index, result.candidates);
      picker.hidden = true;

      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent =
        'Picking a product pins it and re-adds this item. Remove the wrong product from your cart manually.';
      note.hidden = true;

      wrongBtn.addEventListener('click', () => {
        picker.hidden = !picker.hidden;
        note.hidden = picker.hidden;
      });

      li.appendChild(note);
      li.appendChild(picker);
    }

    cartQueueListEl.appendChild(li);
  });
}

function getOrCreateAmazonTab(callback) {
  chrome.tabs.query({ url: AMAZON_MATCH_PATTERN }, (tabs) => {
    if (tabs && tabs.length > 0) {
      callback(tabs[0]);
      return;
    }
    chrome.tabs.create({ url: 'https://www.amazon.com/', active: false }, (tab) => {
      callback(tab);
    });
  });
}

function navigateTabToItem(tabId, item) {
  chrome.tabs.update(tabId, { url: wholeFoodsSearchUrl(item.name) });
}

function startCartQueue() {
  if (!latestExportData || !Array.isArray(latestExportData.items) || latestExportData.items.length === 0) {
    return;
  }

  sendToCartBtn.disabled = true;

  const items = latestExportData.items;

  getOrCreateAmazonTab((tab) => {
    const queue = {
      items,
      results: [],
      currentIndex: 0,
      tabId: tab.id,
    };

    chrome.storage.local.set({ [CART_QUEUE_KEY]: queue }, () => {
      navigateTabToItem(tab.id, items[0]);
    });
  });
}

function retryItem(index) {
  chrome.storage.local.get(CART_QUEUE_KEY, (result) => {
    const queue = result[CART_QUEUE_KEY];
    if (!queue || !Array.isArray(queue.items) || !queue.items[index]) {
      return;
    }

    const results = Array.isArray(queue.results) ? queue.results.slice() : [];
    results[index] = undefined;

    const updatedQueue = {
      ...queue,
      results,
      currentIndex: index,
    };

    chrome.storage.local.set({ [CART_QUEUE_KEY]: updatedQueue }, () => {
      if (queue.tabId != null) {
        navigateTabToItem(queue.tabId, queue.items[index]);
      } else {
        getOrCreateAmazonTab((tab) => {
          chrome.storage.local.set({
            [CART_QUEUE_KEY]: { ...updatedQueue, tabId: tab.id },
          });
          navigateTabToItem(tab.id, queue.items[index]);
        });
      }
    });
  });
}

function loadCartQueue() {
  chrome.storage.local.get([CART_QUEUE_KEY, PINNED_KEY], (result) => {
    renderCartQueue(result[CART_QUEUE_KEY], result[PINNED_KEY] || {});
  });
}

function loadExportData() {
  chrome.storage.local.get(EXPORT_KEY, (result) => {
    renderExport(result[EXPORT_KEY]);
  });
}

openAllBtn.addEventListener('click', () => {
  chrome.storage.local.get(EXPORT_KEY, (result) => {
    const exportData = result[EXPORT_KEY];
    if (!exportData || !Array.isArray(exportData.items)) {
      return;
    }
    exportData.items.forEach((item) => {
      chrome.tabs.create({ url: wholeFoodsSearchUrl(item.name), active: false });
    });
  });
});

sendToCartBtn.addEventListener('click', startCartQueue);

// Keep the popup in sync if the export or cart queue changes while the
// popup is open (e.g. amazon-cart.js reports progress on a step).
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') {
    return;
  }
  if (changes[EXPORT_KEY]) {
    renderExport(changes[EXPORT_KEY].newValue);
  }
  if (changes[CART_QUEUE_KEY] || changes[PINNED_KEY]) {
    loadCartQueue();
  }
});

loadExportData();
loadCartQueue();
