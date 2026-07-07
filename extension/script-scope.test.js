/** @jest-environment node */

// Regression test for the popup death on load (2026-07-06): popup.html's
// classic <script> tags share ONE global scope, so a top-level
// `const wholeFoodsSearchUrl` in popup.js collided with the top-level
// `function wholeFoodsSearchUrl` from lib/urls.js — a parse-time
// SyntaxError that killed the whole popup (no button, no rendering).
// Neither `node --check` nor Jest's require() catches this class (each
// gives files a private scope), so these tests emulate the browser:
// evaluate each script, in tag order, inside one shared VM context per
// surface (popup page, background worker's importScripts chain, amazon
// content scripts).

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const EXT = __dirname;

function makeChromeFake() {
  return {
    storage: {
      local: {
        get: (keys, cb) => cb({}),
        set: (obj, cb) => cb && cb(),
        remove: () => {},
      },
      onChanged: { addListener: () => {} },
    },
    tabs: {
      query: (q, cb) => cb([]),
      create: () => {},
      update: (id, props, cb) => cb && cb(),
    },
    runtime: {
      lastError: undefined,
      sendMessage: (msg, cb) => cb && cb(undefined),
      onMessage: { addListener: () => {} },
    },
    scripting: { executeScript: (opts, cb) => cb && cb([]) },
  };
}

function runScriptsInSharedDomScope(html, scriptFiles) {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://www.example.com/',
  });
  const context = dom.getInternalVMContext();
  context.chrome = makeChromeFake();
  scriptFiles.forEach((file) => {
    const src = fs.readFileSync(path.join(EXT, file), 'utf8');
    vm.runInContext(src, context, { filename: file });
  });
  return context;
}

describe('extension script scopes (classic scripts share one global scope)', () => {
  test('popup.html script tags load together without identifier collisions', () => {
    const html = fs.readFileSync(path.join(EXT, 'popup.html'), 'utf8');
    // Derive the script list from popup.html itself so this test can never
    // drift from what the real popup loads.
    const probe = new JSDOM(html);
    const scripts = Array.from(
      probe.window.document.querySelectorAll('script[src]')
    ).map((el) => el.getAttribute('src'));
    expect(scripts.length).toBeGreaterThanOrEqual(2);

    const context = runScriptsInSharedDomScope(html, scripts);
    expect(typeof context.GroceryUrls).toBe('object');
    expect(typeof context.readGroceryExport).toBe('function');
  });

  test('background worker importScripts chain loads without collisions', () => {
    const context = vm.createContext({ console, chrome: makeChromeFake() });
    ['lib/matcher.js', 'lib/urls.js', 'background.js'].forEach((file) => {
      const src = fs.readFileSync(path.join(EXT, file), 'utf8');
      vm.runInContext(src, context, { filename: file });
    });
  });

  test('amazon content scripts load together without collisions', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')
    );
    const amazonEntry = manifest.content_scripts.find((cs) =>
      cs.matches.some((m) => m.includes('amazon'))
    );
    runScriptsInSharedDomScope('<!doctype html><body></body>', amazonEntry.js);
  });
});
