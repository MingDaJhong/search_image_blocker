# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Stack

WXT (extension framework) + Vue 3 + TypeScript + TailwindCSS, packaged with pnpm. Targets Chrome (MV3) and Firefox via the `:firefox` script variants.

## Commands

```bash
pnpm dev              # launches Chrome with the extension auto-loaded (HMR)
pnpm dev:firefox      # same, for Firefox
pnpm build            # production build → .output/chrome-mv3
pnpm zip              # build + zip for store upload
pnpm compile          # vue-tsc --noEmit (type-check only; no test runner configured)
```

There is no test suite, no linter, and no formatter wired up. `pnpm compile` is the only correctness gate. `pnpm postinstall` runs `wxt prepare`, which regenerates `.wxt/` (typed `#imports`, tsconfig base, manifest types) — re-run it if those become stale.

## Architecture

The extension has two runtime surfaces and one shared module — keep them in sync:

1. **Content script** (`entrypoints/content/index.ts`) — injected into `google.com/search*` and `google.com.tw/search*` at `document_start`. The single `applyState(settings)` function is the source of truth for what's currently active; it runs once at boot and again on every `browser.storage.onChanged` event so settings changes apply live without a page reload. It coordinates two parallel tracks:
   - **Pause early-exit**: when `settings.paused === true`, `applyState` removes `sib-block-style`, disconnects the autocomplete observer, clears any inline `visibility:hidden` it set, and returns. No CSS or observer remains attached — flipping pause on/off in the popup is instant and has zero residual cost.
   - **Page-level blocking (CSS)**: phase 1 inject a temporary "hide suspicious blocks" `<style>` (`sib-initial-hide`); phase 2 `await loadSettings()` and call `shouldBlock(urlQuery, settings)`; if true, swap in the real selector list (`sib-block-style`), if false remove the temporary one. The CSS selectors target Google's DOM (`g-scrolling-carousel`, `video-voyager`, `div[data-attrid*="..."]`) — **Google rotates these regularly**, expect to update them when blocking breaks.
   - **Autocomplete blocking (MutationObserver)** in `observeAutocomplete()`: attached/detached by `applyState` based on `settings.blockTypes.searchPreview`, *independent of URL-level blocking*. The observer is created lazily (only when needed) and re-uses a `getSettings` getter so storage updates are read live without re-creating the observer. Two signals decide what to hide inside the autocomplete dropdown:
     - **Per `[role="option"]`**: each option's `textContent` is run through `shouldBlock` — only that option's images get hidden. Lets `q=蟾蜍` page show an unrelated `坤達` suggestion preview.
     - **Outer preview panel** (the right-side knowledge entity card that's a sibling of the listbox, not inside any option): hidden when **(a) the search input value matches** OR **(b) any option's text matches**. The "any option" signal exists because users may only have typed a partial term (`青`) when Google already surfaces a matching entity (`青蛙`). The container is found by walking up one level from `[role="listbox"]`.
   - Image selector (`IMG_SELECTOR`) covers `img, g-img, svg, picture, [style*="background-image"], [style*="url("]` — Google uses several variants for thumbnails. The observer also watches `attributes: ['src', 'style', 'data-src']` because thumbnails are often lazy-loaded.

2. **Popup UI** (`entrypoints/popup/App.vue`) — Vue 3 `<script setup>` + Tailwind. Settings auto-save via the composable's `watch`. Header has theme (🌙/☀️) and language (中/EN) toggle buttons.
   - **View state**: `detailCategoryId` controls which view is shown — `null` = main screen; a category ID string = that category's detail page (edit label, manage keywords, delete).
   - **Blocking status**: on load, queries `browser.tabs` for the active tab URL; if it's a Google search page, extracts `q=` and runs `findBlockMatch()` to show which keyword / category is currently triggering.
   - Theme uses `darkMode: 'class'` — App.vue watches `settings.theme` and toggles `dark` class on `document.documentElement`, plus mirrors to `localStorage('sib_theme')`. `entrypoints/popup/main.ts` reads that localStorage cache **synchronously before mount** to apply the dark class on the first paint, eliminating flicker (chrome.storage is async-only). First-ever popup open falls back to `prefers-color-scheme`.
   - i18n is a flat `messages: { 'zh-TW': {...}, 'en': {...} }` map at the top of App.vue, accessed as `t.xxx` via a computed. `Category.label` is a plain `string` (locale-specific text stored directly) — it is set at seed time from `DEFAULT_CATEGORIES` (or from `PRESET_TEMPLATES` when the user clicks `+ 範本`) and may be edited by the user.
   - **Preset chips**: when the add-category form is open, a row of `+ <preset label>` chips renders for every `PRESET_TEMPLATES` entry not already in `customCategories`. Click → `addCategoryFromPreset(id)` seeds it. Once added, the chip disappears (filtered by `availablePresets` computed).

3. **Shared composable** (`composables/useBlockList.ts`) — single source of truth for `BlocklistSettings`, `Category`, `DEFAULT_SETTINGS`, `shouldBlock()`, `findBlockMatch()`, and chrome.storage I/O. Both surfaces import from here. Storage key is `sib_settings`; sync via `chrome.storage.sync` (~100KB quota — keep the schema small).
   - `DEFAULT_CATEGORIES` (file-private): bilingual seed data for the 3 built-in auto-seeded categories (`insects`, `reptiles`, `parasites`). Only used on first install or when migrating from a version with no `customCategories`.
   - `PRESET_TEMPLATES` (exported): bilingual seed data for opt-in templates (`gore`, `medical`). **Not auto-seeded** — kept separate from `DEFAULT_CATEGORIES` to reduce Chrome Web Store review risk around shipping a curated gore/medical keyword list as default-on. Users opt in via the popup's `+ 範本` chips. Uses the template's stable `id` as the resulting `Category.id`, so the same preset can't be added twice.
   - `useBlockList()` composable exposes: `settings`, `loaded`, `saveError`, `addKeyword`, `removeKeyword`, `addCategory`, `addCategoryFromPreset`, `removeCategory`, `setCatLabel`, `addCatKeyword`, `removeCatKeyword`.

When adding a new block type:
- Add the field to `BlocklistSettings.blockTypes` and `DEFAULT_SETTINGS.blockTypes`.
- Add a selector branch in `buildBlockCSS()` (page CSS) **or** extend `observeAutocomplete()` if it's autocomplete-specific.
- Add the UI checkbox in `App.vue` and a label string in both `messages.zh-TW` and `messages.en`.

When adding a new built-in keyword category, decide first whether it should auto-seed:
- **Auto-seed (low review risk, broadly useful)** — append a `DefaultCategory` to `DEFAULT_CATEGORIES`. It seeds on first install. To retroactively add for existing users, push it into `customCategories` during a migration step in `loadSettings`.
- **Opt-in template (sensitive content, niche)** — append to `PRESET_TEMPLATES` instead. Users add it via the popup's `+ 範本` chips. No migration needed. Pick this whenever the keyword list could read poorly to a CWS reviewer (gore, medical, NSFW-adjacent, etc.).

Both arrays use the same `DefaultCategory` shape — `label` and `keywords` need both locales.

## Storage gotchas (load-bearing — don't undo without reading)

These all live in `useBlockList.ts`:

1. **`saveSettings` does `JSON.parse(JSON.stringify(settings))` before writing**. Vue 3's reactive Proxy<Array> is not recognized as Array by structured clone — `chrome.storage.sync.set(proxy)` would persist arrays as `{0: ..., 1: ...}` plain objects, then `Array.isArray` fails on read and the data falls back to defaults. JSON round-trip strips the proxy.
2. **`loadSettings` normalizes every field via `Array.isArray` / `typeof` checks** before returning. This self-heals corrupted storage from older buggy versions (e.g. `enabledCategories` once got written as a boolean by Vue's checkbox v-model when the value was `undefined`).
3. **`watch(settings, ..., { flush: 'sync' })`** in `useBlockList()` — must be `sync`, not the default `pre`. Popups can be closed mid-microtask before a batched watcher fires; `sync` ensures the storage write is dispatched on the same call stack as the user's click.
4. **Initial ref deep-clones `DEFAULT_SETTINGS.keywords` and `enabledCategories`** so reactive mutations don't pollute the shared default object.

## Manifest & permissions

The manifest is generated by WXT from `wxt.config.ts` — edit it there, not in `.output/`. Current permissions: `storage` only, with host permissions limited to `google.com` and `google.com.tw`. Adding new Google TLDs requires updating both `host_permissions` in `wxt.config.ts` *and* the `matches` array in `entrypoints/content/index.ts`.

## Path aliases

`@/` resolves to the project root (provided by WXT's generated tsconfig). Use `@/composables/...` rather than relative paths.

## Known gaps

- Google CSS selectors in `entrypoints/content/index.ts` need ongoing maintenance as Google rotates its DOM. This is expected and the most likely cause of breakage.
- Theme is binary (light/dark only) — three-state auto-follow-OS would need a separate `prefers-color-scheme` watcher and a new `'auto'` value in `Theme`.
- `autocomplete` observer currently watches `documentElement`; could be narrowed to the search input's ancestor to reduce DOM event overhead.
