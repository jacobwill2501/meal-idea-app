// Popup UI: reads the groceryExport mirrored by app-reader.js out of
// chrome.storage.local and offers "assisted mode" — opening a
// Whole-Foods-scoped Amazon search tab per item so the user can add each
// one to their cart manually. This is the reliable, scrape-free mode.

const EXPORT_KEY = 'groceryExport';

const exportMetaEl = document.getElementById('export-meta');
const emptyStateEl = document.getElementById('empty-state');
const assistedModeEl = document.getElementById('assisted-mode');
const openAllBtn = document.getElementById('open-all-btn');
const itemListEl = document.getElementById('item-list');

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
  if (!exportData || !Array.isArray(exportData.items) || exportData.items.length === 0) {
    emptyStateEl.hidden = false;
    assistedModeEl.hidden = true;
    exportMetaEl.textContent = 'No export data yet.';
    return;
  }

  emptyStateEl.hidden = true;
  assistedModeEl.hidden = false;

  const { items, exportedAt } = exportData;
  const itemWord = items.length === 1 ? 'item' : 'items';
  exportMetaEl.textContent = `${items.length} ${itemWord} - exported ${formatTimestamp(exportedAt)}`;

  renderItems(items);
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

// Keep the popup in sync if the export changes while the popup is open.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes[EXPORT_KEY]) {
    renderExport(changes[EXPORT_KEY].newValue);
  }
});

loadExportData();
