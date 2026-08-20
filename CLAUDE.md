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
pnpm compile          # vue-tsc --noEmit (type-check)
pnpm test             # vitest run — pure-function regression suite
pnpm test:watch       # vitest in watch mode
```

There is no linter or formatter wired up. The correctness gates are `pnpm compile` and `pnpm test` — run both. Vitest is configured through `vitest.config.ts` using WXT's own `WxtVitest()` plugin, which supplies the `@/` alias and mocks `wxt/browser` with `@webext-core/fake-browser` (importing `wxt/browser` in plain Node throws, since it pulls in `webextension-polyfill`). Tests live next to the code (`composables/*.test.ts`, `entrypoints/content/*.test.ts`). `entrypoints/content/*.test.ts` run under happy-dom (via a `// @vitest-environment happy-dom` pragma) — **not** jsdom, which replaces global `Uint8Array` and breaks esbuild's startup invariant.

**happy-dom does not support descendant combinators inside `:not()`, and fails silently rather than throwing.** `#search img:not(cite img)` returns the favicon there; real Chrome (Selectors L4, since Chrome 88) does not. Selector *syntax* validation still works, but never write a count/matching assertion that depends on the `:not(:is(cite img, …))` exclusion — you would be testing happy-dom, not the product. `pnpm postinstall` runs `wxt prepare`, which regenerates `.wxt/` (typed `#imports`, tsconfig base, manifest types) — re-run it if those become stale.

## Architecture

The extension has two runtime surfaces and one shared module — keep them in sync:

1. **Content script** (`entrypoints/content/index.ts`) — injected into 16 Google TLDs (`google.com`, `google.com.tw`, `google.co.jp`, …) at `document_start`. Imports from `@/composables/blockList` (the pure layer) — never from `useBlockList`, to keep Vue runtime out of the content bundle. The single `applyState(settings)` function is the source of truth for what's currently active; it runs once at boot and again on every `browser.storage.onChanged` event so settings changes apply live without a page reload. It coordinates two parallel tracks:
   - **Pause early-exit**: when `settings.paused === true`, `applyState` removes `sib-block-style`, disconnects the autocomplete observer, clears any inline `visibility:hidden` it set, and returns. No CSS or observer remains attached — flipping pause on/off in the popup is instant and has zero residual cost.
   - **Page-level blocking (CSS)**: phase 1 inject a temporary hide `<style>` (`sib-initial-hide`); phase 2 `await loadSettings()` and call `shouldBlock(urlQuery, settings)`; if true, swap in the real selector list (`sib-block-style`), if false remove the temporary one. All selector logic lives in **`entrypoints/content/selectors.ts`** (zero runtime imports — `BlocklistSettings` is `import type` only — so tests can load it without triggering the content script). The CSS targets Google's DOM (`g-scrolling-carousel`, `video-voyager`, `div[data-attrid*="..."]`) — **Google rotates these regularly**, expect to update them when blocking breaks.
   - **The phase-1 hide must be a superset of what the settings could block.** It uses `INITIAL_HIDE_BLOCK_TYPES` (every image-bearing type on; `relatedQuestions` / `knowledgePanel` off because they are text blocks and blanking them just makes every search flicker — knowledge-panel imagery is already covered by `thumbnails`' `#rcnt img`). This is load-bearing: between `document_start` and the storage round-trip Google streams and paints, so anything not covered here can flash. The old hand-written list omitted `thumbnails` — a default-on type — meaning the most common configuration had no protection at all during that window. `selectors.test.ts` asserts the superset property.
   - Phase 1 uses `visibility: hidden`, phase 2 uses `display: none`. `visibility` preserves layout, so removing it causes no reflow.
   - **CSS is emitted one rule per selector, never a comma-joined list.** Per the CSS spec a single invalid selector in a group invalidates the *entire* rule — comma-joining would mean one typo silently kills all blocking. Split, a broken selector only disables itself.
   - **Per-result blocking** (`entrypoints/content/resultScanner.ts`, gated on `settings.perResultBlock`, default on) — the answer to query-level blocking's blind spot. Searching `我家牆上這是什麼` matches no keyword, yet every result is titled 蜘蛛; that is precisely when the user most needs protection. The scanner reads each image's surrounding result text and hides only that image. It **runs only when the query itself did not match** — otherwise the page CSS already hides everything, so scanning would waste CPU and double-count.
     - Two signals per image, cheapest and most specific first: `collectImageLabels()` reads the image's own `alt` / `title` / `aria-label` plus the enclosing link's, then `collectResultContexts()` walks up for the surrounding result text. Neither touches a Google container attribute — no `data-hveid`, no `jscontroller`, no class names — so both survive DOM rotation.
     - The label signal is not merely a cheaper version of the context one. It is what covers the **Images tab (`udm=2`)**, where each tile has almost no surrounding text but a meaningful `alt` — and that is the single most important page for this product.
     - `collectResultContexts()` returns every ancestor's text from nearest outward, and the scanner tests each. There is deliberately **no "minimum characters" threshold**: a character count is biased against CJK (`家中常見的蜘蛛種類` is 9 chars and fully informative; the English equivalent needs 25+), and stopping at the first "long enough" ancestor can park on an ad badge and never see the title.
     - `MAX_CONTEXT_CHARS` (400) stops the walk when the text is clearly the whole result list. Without it, one keyword anywhere on the page would hide every image — degrading back into query-level blocking and losing the only thing this feature offers.
     - Scan roots are `#search, #rcnt, #center_col`, falling back to `document.body` when none exist. Scanning too much is the safe direction here — a layout we failed to anticipate means *no protection at all*, whereas an over-broad root mostly costs a few extra `alt` reads that will not match.
     - Each image is processed once (`WeakSet`), mutations are debounced 300 ms, and `disconnect()` restores every inline `display` it set. Worst case is ~1 ms per scan.
   - **On-page indicator** (`entrypoints/content/indicator.ts`, gated on `settings.pageIndicator`, default on): a small pill bottom-left of a blocked SERP. It does three jobs at once — explains what happened ("已隱藏 12 個區塊 · 關鍵字「蛇」"), offers a per-page escape hatch, and surfaces selector rot. Rendered in a **closed** shadow root: the pill displays the matched keyword, which is the user's blocklist data, and a closed root keeps Google's own scripts from reading it. Its logo is `public/icon/48.png` imported directly so Vite inlines it as a data URI — deliberately **not** `browser.runtime.getURL()`, which would require listing the file in `web_accessible_resources` and thereby let google.com probe whether this extension is installed. `wxt.config.ts` raises `assetsInlineLimit` to 8 KB precisely so this cannot silently reverse: the default 4 KB sits too close to the 3.9 KB icon, and Vite emits a separate file instead of inlining without any warning once an asset crosses the limit. `update()` diffs against the last state and skips the DOM write when nothing changed.
   - **Reveal is deliberately non-persistent.** The `revealed` flag lives only in the content script's closure for that page load — no storage write, therefore no privacy cost, and a reload restores blocking. It suppresses both the page CSS and the autocomplete watcher (the dropdown is part of the same page).
   - **Counting**: `countBlockedElements()` dedupes through a `Set` rather than summing each selector's `length` — the selectors overlap heavily (`#search img` and `#rcnt img` hit nearly the same nodes), so summing badly overestimates. A count of 0 while blocking is active is the selector-rot signal, and the pill says so in plain words. This is the only way a user can notice and report a Google DOM change, given the extension ships no telemetry.
   - **Dev-only selector audit**: 2 seconds after DOM ready, when `import.meta.env.DEV`, `devSelectorAudit()` `console.warn`s if `countBlockedElements()` returns 0 while blocking is active. Stripped from production builds by Vite; the indicator carries the same signal for real users.
   - Content-script user-facing strings live in `entrypoints/content/messages.ts`, **not** the popup's `i18n.ts` — that table has ~60 entries in one object literal and importing it would pull all of it into the bundle injected on every page.
   - **Autocomplete blocking (MutationObserver)** in `observeAutocomplete()`: attached/detached by `applyState` based on `settings.blockTypes.searchPreview`, *independent of URL-level blocking*. The observer is created lazily (only when needed) and re-uses a `getSettings` getter so storage updates are read live without re-creating the observer. Two signals decide what to hide inside the autocomplete dropdown:
     - **Per `[role="option"]`**: each option's `textContent` is run through `shouldBlock` — only that option's images get hidden. Lets `q=蟾蜍` page show an unrelated `坤達` suggestion preview.
     - **Outer preview panel** (the right-side knowledge entity card that's a sibling of the listbox, not inside any option): hidden when **(a) the search input value matches** OR **(b) any option's text matches**. The "any option" signal exists because users may only have typed a partial term (`青`) when Google already surfaces a matching entity (`青蛙`). The container is found by walking up one level from `[role="listbox"]`.
   - Image selector (`IMG_SELECTOR`) covers `img, g-img, svg, picture, [style*="background-image"], [style*="url("]` — Google uses several variants for thumbnails. The observer also watches `attributes: ['src', 'style', 'data-src']` because thumbnails are often lazy-loaded.
   - `observeAutocomplete()` returns an `AutocompleteWatcher` handle, not a raw `MutationObserver`. Its `disconnect()` also cancels any queued rAF and restores the inline `visibility` on **only the elements it set** (tracked in a `Set`). The old code swept every `img`/`svg`/`picture` in the document and cleared their `visibility`, which also wiped values Google had set itself.
   - **Performance**: mutations are batched through a `requestAnimationFrame` debounce (one `processAll()` per frame); `processAll()` early-returns when `[role="listbox"]` is absent; writes only happen when the hidden state actually changes. The observation root is narrowed to the search input's enclosing `<form>` — but the watcher is created only a few ms after `document_start` (it waits on a storage IPC), when `<body>` often does not exist yet, so `closest("form")` returns null. It therefore starts on `documentElement` and **re-narrows on `DOMContentLoaded`**. Without that retry the narrowing silently never happened on a cold load.

2. **Popup UI** (`entrypoints/popup/`) — Vue 3 `<script setup>` + Tailwind. Settings auto-save via the composable's `watch`. Header has theme (🌙/☀️) and language (中/EN) toggle buttons. Split across three files:
   - `App.vue` — main screen (block-types, categories list with vuedraggable, custom keywords, header menu, footer).
   - `CategoryDetail.vue` — detail page rendered when a category is opened (edit label, add/remove keywords, delete category). Receives `category`, `t`, and the relevant mutators (`setCatLabel` / `addCatKeyword` / `removeCatKeyword` / `removeCategory`) as props, emits `deleted` so App.vue can close the view.
   - `KeywordSection.vue` — the shared "title + input + chip list" block, used by **three** call sites: custom keywords, exception keywords (App.vue), and a category's keyword list (CategoryDetail.vue). Takes `add` / `remove` as function props and owns the validation-feedback state (red border + message for 2.5s on a non-`'added'` result), so that logic exists once. `tone` picks the chip colour and is meaningful, not decorative: blue = matching this blocks, green = matching this allows.
   - `i18n.ts` — exports `messages: { 'zh-TW': {...}, 'en': {...} }` and the derived `Messages` type (`(typeof messages)[Locale]`). Both popup components import from here.
   - **View state**: `detailCategoryId` in App.vue controls which view is shown — `null` = main screen; a category ID string = that category's `<CategoryDetail>`. App.vue passes `detailCategory` (resolved from settings) into the child.
   - **Blocking status**: on load, queries `browser.tabs` for the active tab URL; if it's a Google search page, extracts `q=` and runs `findBlockMatch()` to show which keyword / category is currently triggering — or `findAllowMatch()` to show which exception let the page through. The two banners are mutually exclusive by construction.
   - Theme uses `darkMode: 'class'` — App.vue watches `settings.theme` and toggles `dark` class on `document.documentElement`, plus mirrors to `localStorage('sib_theme')`. `entrypoints/popup/main.ts` reads that localStorage cache **synchronously before mount** to apply the dark class on the first paint, eliminating flicker (chrome.storage is async-only). First-ever popup open falls back to `prefers-color-scheme`.
   - `Category.label` is a plain `string` (locale-specific text stored directly) — it is set at seed time from `DEFAULT_CATEGORIES` (or from `PRESET_TEMPLATES` when the user clicks `+ 範本`) and may be edited by the user.
   - **Preset chips**: when the add-category form is open, a row of `+ <preset label>` chips renders for every `PRESET_TEMPLATES` entry not already in `customCategories`. Click → `addCategoryFromPreset(id)` seeds it. Once added, the chip disappears (filtered by `availablePresets` computed).
   - **Input validation feedback**: `addKeyword` / `addCatKeyword` return `AddKeywordResult` (`'added' | 'duplicate' | 'empty' | 'too_long'`). The UI flashes the input's border red and shows `errorEmpty` / `errorDuplicate` / `errorTooLong` for 2.5s on a non-`'added'` result. Length caps come from `MAX_KEYWORD_LEN` (50) / `MAX_LABEL_LEN` (30) exported from the composable; inputs also bind `:maxlength` so paste / IME past the cap is stopped at the DOM. `addCategory` / `setCatLabel` reject silently when over the label cap because the input's `maxlength` already prevents reaching that state from the UI.
   - **Import / export**: header menu offers `exportSettings` (downloads `sib-settings-YYYY-MM-DD.json` wrapped in `{ version: 1, exportedAt, settings }`) and `importSettings` (file picker → `parseImport()` → on success, the parsed object is held in `pendingImport` and a modal asks **合併 / 取代 / 取消**). `applyImportMerge` calls `mergeSettings(current, parsed)` (union of keywords / categories, current UI prefs preserved); `applyImportReplace` overwrites wholesale. Banner shows result. The merge path exists so a misclick doesn't wipe the user's customizations.
   - **Storage quota**: footer reads `browser.storage.sync.getBytesInUse(STORAGE_KEY)` after load and on every `storage.onChanged` for that key. Renders an `X.X / 100 KB` progress bar that turns amber at 70% and red at 90%. The `STORAGE_QUOTA = 102400` constant is `chrome.storage.sync.QUOTA_BYTES`. `getBytesInUse` is silently skipped if unsupported (Firefox).

3. **Shared logic** — split across two files for content/popup boundary clarity:
   - **`composables/blockList.ts`** — pure layer, **no Vue dependency**. Contains types (`BlocklistSettings`, `Category`, `DefaultCategory`, `Locale`, `Theme`), constants (`STORAGE_KEY`, `MAX_KEYWORD_LEN`, `MAX_LABEL_LEN`, `DEFAULT_SETTINGS`), `DEFAULT_CATEGORIES` (file-private bilingual seed for the 3 built-in auto-seeded categories: `insects` / `reptiles` / `parasites`), normalize helpers (`normalizeCategories`, `normalizeCategoryOrder`, `seedDefaultCategories`, `detectDefaultLocale`, `detectDefaultTheme`), chrome.storage I/O (`loadSettings`, `saveSettings`), `DEFAULT_ALLOW_KEYWORDS` + `seedDefaultAllowKeywords`, and pure matchers (`matchKeyword`, `shouldBlock`, `findBlockMatch`, `findAllowMatch`). Content script imports directly from here.
   - **`composables/useBlockList.ts`** — popup-only layer. `export * from './blockList'` so popup components keep one import path. Adds: `PRESET_TEMPLATES` (bilingual seed for opt-in templates `gore` / `medical` — **not auto-seeded** to reduce Chrome Web Store review risk; users opt in via the popup's `+ 範本` chips, and the template's stable `id` is reused as `Category.id` so the same preset can't be added twice), `AddKeywordResult` type, the `useBlockList()` Vue composable, `parseImport`, and `mergeSettings`. Vite tree-shaking keeps these out of the content bundle.
   - `useBlockList()` exposes: `settings`, `loaded`, `saveError`, `addKeyword`, `removeKeyword`, `addAllowKeyword`, `removeAllowKeyword`, `addCategory`, `addCategoryFromPreset`, `addCategoryFromDefault`, `removeCategory`, `setCatLabel`, `addCatKeyword`, `removeCatKeyword`. Mutators that take user-typed strings (`addKeyword`, `addCatKeyword`) return `AddKeywordResult` (`'added' | 'duplicate' | 'empty' | 'too_long'`) so the UI can render inline validation feedback. The same length caps (`MAX_KEYWORD_LEN` / `MAX_LABEL_LEN`) are also enforced inside `loadSettings` / `parseImport` filters, so corrupted storage or a malicious import can't smuggle in oversized strings.
   - `parseImport(jsonStr)` accepts either the wrapped `{ version: 1, settings }` shape or a bare settings object (back-compat) and runs the same per-field type guards as `loadSettings`. Returns `null` on any parse / shape failure — popup uses that null to show the import-error banner.
   - `mergeSettings(current, imported)` — union of `keywords` / `enabledCategories`, per-id merge of `customCategories` (current label kept on collision, keywords union), preserves current `paused` / `globalBlock` / `blockTypes` / `locale` / `theme`. Used by App.vue's import dialog when the user picks 合併.

   Storage key is `sib_settings` (exported as `STORAGE_KEY`); sync via `chrome.storage.sync` (~100KB quota — keep the schema small).

When adding a new block type:
- Add the field to `BlocklistSettings.blockTypes` and `DEFAULT_SETTINGS.blockTypes`.
- Add a selector branch in `buildBlockCSS()` (page CSS) **or** extend `observeAutocomplete()` if it's autocomplete-specific.
- Add the UI checkbox in `App.vue` and a label string in both `messages['zh-TW']` and `messages.en` in `entrypoints/popup/i18n.ts`.

When adding a new built-in keyword category, decide first whether it should auto-seed:
- **Auto-seed (low review risk, broadly useful)** — append a `DefaultCategory` to `DEFAULT_CATEGORIES`. It seeds on first install. To retroactively add for existing users, push it into `customCategories` during a migration step in `loadSettings`.
- **Opt-in template (sensitive content, niche)** — append to `PRESET_TEMPLATES` instead. Users add it via the popup's `+ 範本` chips. No migration needed. Pick this whenever the keyword list could read poorly to a CWS reviewer (gore, medical, NSFW-adjacent, etc.).

Both arrays use the same `DefaultCategory` shape — `label` and `keywords` need both locales.

## Keyword matching (load-bearing — don't simplify back to `includes`)

`matchKeyword(haystack, keyword)` in `blockList.ts` is the single matcher; `shouldBlock` and
`findBlockMatch` both route through it. It is **not** a plain substring test, and reverting it to
one reintroduces a serious bug:

1. **Latin / Cyrillic / Greek keywords match on word boundaries**, with `s` / `es` allowed as a
   trailing plural. Plain `includes` made `moth` match `mother's day gift`, `boa` match
   `keyboard shortcuts`, `mite` match `limited edition`, `rash` match `car crash`, `tick` match
   `ticket prices`, `newt` match `newton laws`, `louse` match `blouse` — i.e. every image on an
   unrelated SERP silently disappeared, with no on-page explanation of why.
2. **CJK keywords keep substring matching**, because CJK has no word delimiters to anchor to.
   Chinese false positives (`蟬聯冠軍` → `蟬`, `蛇年運勢` → `蛇`, `螞蟻上樹` → `螞蟻`) cannot be
   fixed at the matcher level at all — they are handled one layer up, by `settings.allowKeywords`
   (see below). Don't try to "fix" `matchKeyword` for CJK; the tests assert its current behaviour
   deliberately.
3. Script detection is the `WORD_DELIMITED` regex; anything outside those scripts falls back to
   substring. Korean and Thai therefore use substring today — conservative, matches the old
   behaviour, no regression.
4. **Never build a regex out of user input** (ReDoS). `indexOf` plus a character check on each
   side is enough and is what the implementation does.
5. **`settings.allowKeywords` is the exception list**, checked inside `shouldBlock`. The full
   precedence is fixed and load-bearing:

   ```
   paused        → never block   (the universal escape hatch)
   globalBlock   → always block  (deliberately above the allowlist — see below)
   allowKeywords → never block
   keywords / enabled categories → block
   ```

   `globalBlock` sitting *above* the allowlist is a deliberate call: it is the "hide everything"
   nuclear option and should not have holes punched in it by a stale exception. A user who wants
   to see one page while `globalBlock` is on uses `paused`, which already exists for exactly that.
   Flipping this ordering is a one-line change if the product decision changes.

   `DEFAULT_ALLOW_KEYWORDS` (file-private, bilingual) is seeded on first install by
   `seedDefaultAllowKeywords(locale)`. **Migration rule**: in `loadSettings` / `parseImport`,
   `allowKeywords === undefined` means "pre-B5 record, seed it"; an actual array — *including an
   empty one* — is respected, because the user may have deliberately cleared the list. Getting
   this backwards silently re-adds exceptions the user removed.

   Entries must earn their place: an exception that would not have been blocked anyway is dead
   weight and a needless hole. The test `每一條內建例外都真的必要` asserts every default entry is
   blocked when the allowlist is removed — that check already caught `beetlejuice` and
   `hard boiled`, which `matchKeyword`'s word-boundary rule handles on its own.

   `findAllowMatch(query, settings)` reports *which* exception let a query through, and returns
   `null` unless the query would actually have been blocked without it — otherwise a user's own
   unrelated exception (e.g. `台北`) would show a bogus "allowed" banner on every page.

6. `isValidKeyword` rejects empty / whitespace-only strings at every storage boundary
   (`loadSettings`, `normalizeCategories`, `parseImport`). An empty keyword would make
   `String.includes` return true for *every* query — a silent global block reachable from a
   corrupted sync record or a crafted import file.

`composables/blockList.test.ts` is the regression net: the false-positive table above is encoded
there as `it.each` cases running against the **real** `DEFAULT_CATEGORIES` / `PRESET_TEMPLATES`
keyword lists, so adding a short new keyword (`ant`, `bee`, `fly`) that collides with common words
fails the suite instead of shipping.

## Storage gotchas (load-bearing — don't undo without reading)

1. **`saveSettings` (in `blockList.ts`) does `JSON.parse(JSON.stringify(settings))` before writing**. Vue 3's reactive Proxy<Array> is not recognized as Array by structured clone — `chrome.storage.sync.set(proxy)` would persist arrays as `{0: ..., 1: ...}` plain objects, then `Array.isArray` fails on read and the data falls back to defaults. JSON round-trip strips the proxy.
2. **`loadSettings` (in `blockList.ts`) normalizes every field via `Array.isArray` / `typeof` checks** before returning. This self-heals corrupted storage from older buggy versions (e.g. `enabledCategories` once got written as a boolean by Vue's checkbox v-model when the value was `undefined`).
3. **`watch(settings, ..., { flush: 'sync' })`** in `useBlockList()` (in `useBlockList.ts`) — must be `sync`, not the default `pre`. Popups can be closed mid-microtask before a batched watcher fires; `sync` ensures the storage write is dispatched on the same call stack as the user's click.
4. **Initial ref deep-clones `DEFAULT_SETTINGS.keywords` and `enabledCategories`** so reactive mutations don't pollute the shared default object.

## Manifest & permissions

The manifest is generated by WXT from `wxt.config.ts` — edit it there, not in `.output/`. Current permissions: `storage` only, with host permissions covering 16 Google TLDs (`com`, `com.tw`, `com.hk`, `co.jp`, `co.kr`, `com.sg`, `co.uk`, `com.au`, `ca`, `co.in`, `de`, `fr`, `es`, `it`, `com.br`, `com.mx`). `composables/googleTlds.ts` is the single source for that list. It deliberately **imports nothing** — it is loaded by Node (`wxt.config.ts`), by the popup, and by tests, and one `wxt/browser` import would crash the Node side (`webextension-polyfill` throws outside a browser). It exports `GOOGLE_TLDS`, `GOOGLE_HOST_PERMISSIONS`, `GOOGLE_SEARCH_MATCHES`, and `isGoogleSearchUrl(url)`.

The `matches: [...]` literal in `entrypoints/content/index.ts` still cannot be generated from it — WXT statically analyzes that array at build time and won't evaluate `.map()`. Instead of a comment asking you to remember, `composables/googleTlds.test.ts` reads the source file and asserts the literal equals `GOOGLE_SEARCH_MATCHES`, so drift fails the suite.

Use `isGoogleSearchUrl()` for "is this tab a Google search page" — never `hostname.includes('google.com')`, which misses the 9 TLDs whose string doesn't contain `google.com` (`co.jp`, `co.kr`, `co.uk`, `ca`, `co.in`, `de`, `fr`, `es`, `it`) while also accepting `google.com.evil.example`.

**`name` / `description` / `action.default_title` use Chrome i18n `__MSG_*__` tokens** (`extName` / `extDescription`), backed by `public/_locales/{zh_TW,en}/messages.json`. `default_locale: 'zh_TW'` is the fallback. To change the user-facing extension name or short description, edit **both** locale files — not `wxt.config.ts`. WXT auto-derives `action.default_title` from the popup's `<title>`, so `entrypoints/popup/index.html` also uses `__MSG_extName__` (plus an explicit `<meta name="manifest.default_title" content="__MSG_extName__" />` to belt-and-suspenders the override).

## Build assets

- **`public/icon/*.png`** — checked into git, bundled into the .crx (anything in `public/` ships).
- **`assets/icons-source/`** — `.gitignored`, **not** bundled. Holds the SVG sources (`scope_icn.svg`, `icon.svg`) and `build.py` (renders SVG → PNG via Chrome headless + Pillow, outputs to `public/icon/`). Kept out of `public/` deliberately so end users can't extract paid-for SVG assets from the .crx. Run `python3 assets/icons-source/build.py` to regenerate PNGs.

## Privacy policy (two copies — keep in sync)

Same content lives in two places:
- `entrypoints/privacy/index.html` — bundled into the extension at build time; popup footer links to `/privacy.html` (resolves to `chrome-extension://<id>/privacy.html`).
- `privacy.html` (repo root) — served by GitHub Pages at `https://mingdajhong.github.io/search_image_blocker/privacy.html`. This is the URL filled into the Chrome Web Store listing's privacy field.

GitHub Pages source is `master /(root)`, so the root copy is what Pages picks up. When updating the policy, edit `entrypoints/privacy/index.html` first, then `cp entrypoints/privacy/index.html privacy.html`. Don't let the two drift.

## Path aliases

`@/` resolves to the project root (provided by WXT's generated tsconfig). Use `@/composables/...` rather than relative paths.

## Known gaps

- Google CSS selectors in `entrypoints/content/index.ts` need ongoing maintenance as Google rotates its DOM. The dev-only `devSelectorAudit` helps catch full-rotation events, but partial breakage (one selector silently failing while others still match something) won't trigger a warning.
- Theme is binary (light/dark only) — three-state auto-follow-OS would need a separate `prefers-color-scheme` watcher and a new `'auto'` value in `Theme`.
