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
pnpm canary           # 週檢：開真 Chrome 打 Google，比對 selector 命中數基準線
pnpm canary:update    # 同上，但把這次結果寫成新基準線
```

`pnpm canary` **不在 `pnpm test` 裡，也永遠不要放進 CI** —— 見下方「Selector 週檢」。

There is no linter or formatter wired up. The correctness gates are `pnpm compile` and `pnpm test` — run both. Vitest is configured through `vitest.config.ts` using WXT's own `WxtVitest()` plugin, which supplies the `@/` alias and mocks `wxt/browser` with `@webext-core/fake-browser` (importing `wxt/browser` in plain Node throws, since it pulls in `webextension-polyfill`). Tests live next to the code (`composables/*.test.ts`, `entrypoints/content/*.test.ts`). `entrypoints/content/*.test.ts` run under happy-dom (via a `// @vitest-environment happy-dom` pragma) — **not** jsdom, which replaces global `Uint8Array` and breaks esbuild's startup invariant.

**happy-dom does not support descendant combinators inside `:not()`, and fails silently rather than throwing.** `#search img:not(cite img)` returns the favicon there; real Chrome (Selectors L4, since Chrome 88) does not. Selector *syntax* validation still works, but never write a count/matching assertion that depends on the `:not(:is(cite img, …))` exclusion — you would be testing happy-dom, not the product. `pnpm postinstall` runs `wxt prepare`, which regenerates `.wxt/` (typed `#imports`, tsconfig base, manifest types) — re-run it if those become stale.

## Architecture

The extension has four runtime surfaces and two shared modules — keep them in sync:

1. **Content script** (`entrypoints/content/index.ts`) — injected into 16 Google TLDs (`google.com`, `google.com.tw`, `google.co.jp`, …) at `document_start`. Imports from `@/composables/blockList` (the pure layer) — never from `useBlockList`, to keep Vue runtime out of the content bundle. The single `applyState(settings)` function is the source of truth for what's currently active; it runs once at boot and again on every `browser.storage.onChanged` event so settings changes apply live without a page reload. It coordinates several parallel tracks:
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
   - **Keeping that count honest** (`entrypoints/content/blockCount.ts`): the pill's number came from a `countBlockedElements()` call made once inside `applyState`, plus two fixed `setTimeout` top-ups (1 s / 3 s). Google's thumbnails load **on scroll**, so both top-ups fire before the user starts scrolling — measured on the video tab: pill said 10, actual was 23. A fixed schedule cannot track a scroll-driven behaviour. Replaced with a MutationObserver + 300 ms debounce over the same result roots, mounted **only while page-level CSS is actually blocking and the indicator is on**; the per-result path already re-notifies through `scanResults`' own `onChange`, and the two never coexist (the scanner only runs when the query did *not* match), so the total cost stays one observer. This deliberately overturns the earlier "not worth an observer for an informational label" call: the number is also the **only** selector-rot signal this product ships (no telemetry), and a count known to under-report makes that signal untrustworthy too.
   - **Reveal is deliberately non-persistent.** The `revealed` flag lives only in the content script's closure for that page load — no storage write, therefore no privacy cost, and a reload restores blocking. It suppresses both the page CSS and the autocomplete watcher (the dropdown is part of the same page).
   - **Counting**: `countBlockedElements()` dedupes through a `Set` rather than summing each selector's `length` — the selectors overlap heavily (`#search img` and `#rcnt img` hit nearly the same nodes), so summing badly overestimates. A count of 0 while blocking is active is the selector-rot signal, and the pill says so in plain words. This is the only way a user can notice and report a Google DOM change, given the extension ships no telemetry.
   - **Dev-only selector audit**: 2 seconds after DOM ready, when `import.meta.env.DEV`, `devSelectorAudit()` `console.warn`s if `countBlockedElements()` returns 0 while blocking is active. Stripped from production builds by Vite; the indicator carries the same signal for real users.
   - Content-script user-facing strings live in `entrypoints/content/messages.ts`, **not** the popup's `i18n.ts` — that table has ~60 entries in one object literal and importing it would pull all of it into the bundle injected on every page.
   - **Hide mode** (`settings.hideMode`, `entrypoints/content/hideStyle.ts`) — `hide` / `blur` / `mask`. `hideStyle.ts` is the single source for the visual treatment, because three places need the *same* one applied differently: page CSS (`selectors.ts` emits rule text), per-result blocking (`resultScanner.ts` writes inline `!important`), and reveal (both have to be cancelled). Split into three implementations, changing the blur radius in only two of them is a matter of time.
     - **Default is `hide`, deliberately.** Existing records have no `hideMode` field, so changing the default would silently change what current users see in an update. `normalizeHideMode()` maps anything unrecognized back to `hide`.
     - **`mask` needs the opaque fill, it is not decoration.** `contrast(0)` maps every channel to a fixed 0.5 — a genuinely flat tile regardless of the source — but it does not touch alpha. On a transparent PNG (common on the Images tab) that leaves a grey *silhouette*, and a silhouette is precisely what a phobic user must not see. The `inset 0 0 0 9999px` box-shadow paints an opaque layer first so the whole border box ends up alpha 1. It is a box-shadow rather than `background-color` so revealing does not have to restore whatever background Google set.
     - **`blur` needs `clip-path: inset(0)`, also not decoration.** `filter: blur()` expands the paint area, so the blur bleeds outside the element and smears over the neighbouring result title (measured: nearly a thumbnail's width of green haze). `clip-path` applies after `filter` and crops it. The parameters (`blur(32px) contrast(0.25) brightness(1.2)`) were picked by rendering them in a real CSS engine — plain `blur(24px)` still left a recognizable shape, and "recognizable" means the feature did not work.
     - **`<video>` is always `display: none`, in every mode** (`collectAlwaysHideSelectors()`). Blur or mask would leave the video in the layout, which means it loads, plays on hover, **and makes sound** — worse than seeing a thumbnail. `selectors.test.ts` asserts this for all three modes.
     - Phase-1 hide is still `visibility: hidden` and still ignores `hideMode`: it runs before the storage round-trip, and `visibility: hidden` is the common upper bound of all three modes.
   - **Click to reveal one element** (`entrypoints/content/clickReveal.ts`, only when `isRevealable(hideMode)`) — the point of blur/mask is that the user decides. Deliberately **click, not hover**: for this audience "it appears when you move the mouse over it" is worse than not seeing it at all.
     - Capture-phase `click` on `document`, because Google's `jsaction` handlers sit on inner elements and the bubble phase is too late. The first click is swallowed (`preventDefault` + `stopImmediatePropagation`) — masks sit on top of result links, and without that the page navigates away before the user sees what they just revealed. The second click passes through normally (by then `find()` returns null).
     - Two reveal paths, because the two blocking layers hide things differently: page CSS is cancelled by a `data-sib-reveal` attribute (`buildBlockCSS` emits a per-selector override rule — a single `[data-sib-reveal]` rule would lose specificity to `#search img` and silently do nothing), and scanner-hidden images are cancelled by `ResultScanner.reveal()` clearing its inline style. `findRevealTarget()` picks the **deepest** match so clicking one image does not unmask the whole carousel.
   - **Soft-navigation query refresh** (`entrypoints/content/softNav.ts`) — A6. `query` used to be read once into the closure; Google's udm-tab and filter-chip switches are partly `pushState`, so `q` changed while `applyState` kept judging on the old value. A content script's isolated world has its own `history` wrapper, so the page's own `pushState` cannot be observed or patched — hence `popstate` (instant for back/forward) plus a 500 ms string-compare poll (everything else). A query change also resets `revealed` and restarts the scanner.
   - **Messages** (`browser.runtime.onMessage`): `sib:toggle-reveal` from the background script's keyboard command, and `sib:diagnose` which returns a `DiagnosisReport`. Diagnosis goes through messaging rather than `chrome.scripting.executeScript` **specifically to avoid adding the `scripting` permission** — a permission upgrade disables an already-published extension until the user re-consents, and a batch of existing users is lost on that dialog.
   - **Autocomplete blocking (MutationObserver)** in `observeAutocomplete()`: attached/detached by `applyState` based on `settings.blockTypes.searchPreview`, *independent of URL-level blocking*. The observer is created lazily (only when needed) and re-uses a `getSettings` getter so storage updates are read live without re-creating the observer. Two signals decide what to hide inside the autocomplete dropdown:
     - **Per `[role="option"]`**: each option's `textContent` is run through `shouldBlock` — only that option's images get hidden. Lets `q=蟾蜍` page show an unrelated `坤達` suggestion preview.
     - **Outer preview panel** (the right-side knowledge entity card that's a sibling of the listbox, not inside any option): hidden when **(a) the search input value matches** OR **(b) any option's text matches**. The "any option" signal exists because users may only have typed a partial term (`青`) when Google already surfaces a matching entity (`青蛙`). The container is found by walking up one level from `[role="listbox"]`.
   - Image selector (`IMG_SELECTOR`) covers `img, g-img, svg, picture, [style*="background-image"], [style*="url("]` — Google uses several variants for thumbnails. The observer also watches `attributes: ['src', 'style', 'data-src']` because thumbnails are often lazy-loaded.
   - `observeAutocomplete()` returns an `AutocompleteWatcher` handle, not a raw `MutationObserver`. Its `disconnect()` also cancels any queued rAF and restores the inline `visibility` on **only the elements it set** (tracked in a `Set`). The old code swept every `img`/`svg`/`picture` in the document and cleared their `visibility`, which also wiped values Google had set itself.
   - **Performance**: mutations are batched through a `requestAnimationFrame` debounce (one `processAll()` per frame); `processAll()` early-returns when `[role="listbox"]` is absent; writes only happen when the hidden state actually changes. The observation root is narrowed to the search input's enclosing `<form>` — but the watcher is created only a few ms after `document_start` (it waits on a storage IPC), when `<body>` often does not exist yet, so `closest("form")` returns null. It therefore starts on `documentElement` and **re-narrows on `DOMContentLoaded`**. Without that retry the narrowing silently never happened on a cold load.

2. **Popup UI** (`entrypoints/popup/`) — Vue 3 `<script setup>` + Tailwind. Settings auto-save via the composable's `watch`. Header has theme (🌙/☀️) and language (中/EN) toggle buttons. Split across three files:
   - `App.vue` — main screen. Split into three tabs plus two pieces of permanent chrome (see **Main-screen IA** below).
   - `CategoryDetail.vue` — detail page rendered when a category is opened (edit label, add/remove keywords, delete category). Receives `category`, `t`, and the relevant mutators (`setCatLabel` / `addCatKeyword` / `removeCatKeyword` / `removeCategory`) as props, emits `deleted` so App.vue can close the view.
   - `KeywordSection.vue` — the shared "title + input + chip list" block, used by **three** call sites: custom keywords, exception keywords (App.vue), and a category's keyword list (CategoryDetail.vue). Takes `add` / `remove` as function props and owns the validation-feedback state (red border + message for 2.5s on a non-`'added'` result), so that logic exists once. `tone` picks the chip colour and is meaningful, not decorative: blue = matching this blocks, green = matching this allows. Two opt-in props default to off and are only turned on in wide mode: `searchable` (a filter box, appearing only past `FILTER_THRESHOLD = 12` keywords — below that scanning with your eyes is faster and an extra input is noise) and `bulk` (paste-many). Bulk paste routes every line through the same `add` prop, so length/duplicate validation has exactly one implementation; `parseBulkKeywords()` only splits and de-dupes.
   - `i18n.ts` — exports `messages: { 'zh-TW': {...}, 'en': {...} }` and the derived `Messages` type (`(typeof messages)[Locale]`). Both popup components import from here.
   - **View state**: a `PopupView` discriminated union (`main` | `category` | `allowKeywords`) — not several booleans, so "two sub-pages open at once" cannot be represented. A watcher drops back to `main` if the open category disappears (deleted on another device).
   - **Main-screen IA**: three tabs — `方式` (how to hide: hide/blur/mask plus the global / per-result / indicator switches), `關鍵字` (categories, exceptions, custom keywords, storage quota), `區塊` (what to hide on the page). `showTab(id)` gates each section and returns `true` unconditionally when `props.wide`, so the **options page renders every section at once with no tab bar** — one template, two surfaces, no forked markup.
   - **The status card is deliberately NOT in a tab.** It sits above the tab bar and stays visible on all three. It is a page-level readout, not a setting; inside a tab, the label can never cover both ("現在" doesn't describe the settings, "方式" doesn't describe the readout) and switching tabs would hide what the page is doing. It has four states — blocked / revealed / idle / offsite — and `idle` says so out loud ("這一頁沒有被阻擋 · 搜尋字沒有命中任何關鍵字") because "why isn't it blocking?" is the question users actually have.
   - **The content script's report outranks query-level matching for the card's state** — `summarizePageStatus()` in `diagnostics.ts` (pure, tested) owns that decision, not a Vue computed. Per-result blocking runs inside the page: searching `像是蛛` matches no keyword at all, yet the scanner hides ~50 images because the *results* are about 蜘蛛. Deciding from `findBlockMatch(query)` alone made the popup say "這一頁沒有被阻擋" while the on-page indicator simultaneously read "已隱藏 52 個區塊". Query matching is the fallback for when the content script can't be reached (not a search page, tab predates install, screenshot mode). `DiagnosisReport.scannerMatch` carries the keyword that caused it, because the popup cannot recompute that.
   - The card's hidden **count** comes from the content script: only it knows how many elements matched. `fetchReport()` sends `DIAGNOSE_MESSAGE` on popup load, shared with the diagnose button — same question, one pipeline. When the message fails (not a search page, tab predates install) the count stays `null` and the card renders without a number rather than showing a fabricated `0`. Its reveal button sends `TOGGLE_REVEAL_MESSAGE`, the same message the keyboard shortcut and the on-page indicator use.
   - **Storage quota lives in the `關鍵字` tab**, not the footer — it measures those lists, so it belongs beside them. The footer holds only the privacy-policy link, which is permanent: not tab-scoped and never conditional.
   - `saveError` renders in the permanent chrome, not inside a tab: quota-exceeded can be triggered from any tab and must not be hidden by whichever one happens to be open.
   - Block types are data-driven from `blockGroups` (a computed), split into `圖片與影片` and `整塊區域`. The last two hide text along with the images and default to off; as a flat list of seven checkboxes that difference was invisible.
   - Theme uses `darkMode: 'class'` — App.vue watches `settings.theme` and toggles `dark` class on `document.documentElement`, plus mirrors to `localStorage('sib_theme')`. `entrypoints/popup/main.ts` reads that localStorage cache **synchronously before mount** to apply the dark class on the first paint, eliminating flicker (chrome.storage is async-only). First-ever popup open falls back to `prefers-color-scheme`.
   - `Category.label` is a plain `string` (locale-specific text stored directly) — it is set at seed time from `DEFAULT_CATEGORIES` (or from `PRESET_TEMPLATES` when the user clicks `+ 範本`) and may be edited by the user.
   - **Preset chips**: when the add-category form is open, a row of `+ <preset label>` chips renders for every `PRESET_TEMPLATES` entry not already in `customCategories`. Click → `addCategoryFromPreset(id)` seeds it. Once added, the chip disappears (filtered by `availablePresets` computed).
   - **Input validation feedback**: `addKeyword` / `addCatKeyword` return `AddKeywordResult` (`'added' | 'duplicate' | 'empty' | 'too_long'`). The UI flashes the input's border red and shows `errorEmpty` / `errorDuplicate` / `errorTooLong` for 2.5s on a non-`'added'` result. Length caps come from `MAX_KEYWORD_LEN` (50) / `MAX_LABEL_LEN` (30) exported from the composable; inputs also bind `:maxlength` so paste / IME past the cap is stopped at the DOM. `addCategory` / `setCatLabel` reject silently when over the label cap because the input's `maxlength` already prevents reaching that state from the UI.
   - **Import / export**: header menu offers `exportSettings` (downloads `sib-settings-YYYY-MM-DD.json` wrapped in `{ version: 1, exportedAt, settings }`) and `importSettings` (file picker → `parseImport()` → on success, the parsed object is held in `pendingImport` and a modal asks **合併 / 取代 / 取消**). `applyImportMerge` calls `mergeSettings(current, parsed)` (union of keywords / categories, current UI prefs preserved); `applyImportReplace` overwrites wholesale. Banner shows result. The merge path exists so a misclick doesn't wipe the user's customizations.
   - **Hide mode picker**: a radio group (`遮蔽方式` / `How to hide`) bound to `settings.hideMode`. The hint text states the trade-off explicitly — blur/mask keep the layout and allow per-image reveal, but the images still download.
   - **Failure diagnosis** (B8): header menu → `檢查是否失效`. Sends `sib:diagnose` to a Google search tab and renders the verdict from `summarizeDiagnosis()`. The load-bearing part of that function is separating "nothing to do here" from "broken": only when the query *did* match does a count of 0 mean selector rot. Without that distinction a user pressing the button on any page would be told the extension is broken — worse than not having the button.
   - **Finding the tab to inspect**: `findSearchTab()` prefers the active tab, then falls back to the most recently accessed tab matching `GOOGLE_SEARCH_MATCHES`. The fallback exists because the options page *is* the active tab, so without it both the blocking banner and the diagnosis would always be empty there. The url filter relies on existing host permissions — no new permission.
   - **Keyboard shortcuts** (wide only): read from `browser.commands.getAll()`, not from the manifest's suggested keys — a user who remapped them in `chrome://extensions/shortcuts` would otherwise be shown the wrong keys. Listed only on the options page, because users do not go browsing that Chrome page on their own, so an undiscovered shortcut is the same as no shortcut.
   - **Storage quota**: footer reads `browser.storage.sync.getBytesInUse(STORAGE_KEY)` after load and on every `storage.onChanged` for that key. Renders an `X.X / 100 KB` progress bar that turns amber at 70% and red at 90%. The `STORAGE_QUOTA = 102400` constant is `chrome.storage.sync.QUOTA_BYTES`. `getBytesInUse` is silently skipped if unsupported (Firefox).

3. **Background service worker** (`entrypoints/background.ts`) — does exactly one thing: relays the `toggle-reveal` keyboard command to the active tab's content script. `_execute_action` (open the popup) needs no code at all. The reveal state lives only in the content script's closure (deliberately never persisted), so a message is the only way to reach it.

4. **Options page** (`entrypoints/options/`) — mounts the **same** `App.vue` with `wide: true`; there is no `OptionsApp.vue`. `wide` decides what is worth spreading out rather than just how wide the page is: exceptions render inline instead of behind a sub-page, `KeywordSection` turns on its filter box and bulk paste, sections lay out in two columns, and the keyboard-shortcut list appears. A second component would start drifting from the popup on the first new setting — the same reason `KeywordSection` exists. `open_in_tab: true` comes from a `<meta name="manifest.open_in_tab">` in its `index.html`; the whole point is having room, so the `chrome://extensions` iframe would defeat it.
   - `entrypoints/popup/style.css` is shared, so the 360 px width is on `body.sib-popup` (set in the popup's `index.html`), **not** on `html, body` — putting it back there would clamp the options page to 360 px too.

5. **Shared logic** — split across two files for content/popup boundary clarity:
   - **`composables/blockList.ts`** — pure layer, **no Vue dependency**. Contains types (`BlocklistSettings`, `Category`, `DefaultCategory`, `Locale`, `Theme`), constants (`STORAGE_KEY`, `MAX_KEYWORD_LEN`, `MAX_LABEL_LEN`, `DEFAULT_SETTINGS`), `DEFAULT_CATEGORIES` (file-private bilingual seed for the 3 built-in auto-seeded categories: `insects` / `reptiles` / `parasites`), normalize helpers (`normalizeCategories`, `normalizeCategoryOrder`, `seedDefaultCategories`, `detectDefaultLocale`, `detectDefaultTheme`), chrome.storage I/O (`loadSettings`, `saveSettings`), `DEFAULT_ALLOW_KEYWORDS` + `seedDefaultAllowKeywords`, and pure matchers (`matchKeyword`, `shouldBlock`, `findBlockMatch`, `findAllowMatch`). Content script imports directly from here.
   - **`composables/useBlockList.ts`** — popup-only layer. `export * from './blockList'` so popup components keep one import path. Adds: `PRESET_TEMPLATES` (bilingual seed for opt-in templates `gore` / `medical` — **not auto-seeded** to reduce Chrome Web Store review risk; users opt in via the popup's `+ 範本` chips, and the template's stable `id` is reused as `Category.id` so the same preset can't be added twice), `AddKeywordResult` type, the `useBlockList()` Vue composable, `parseImport`, and `mergeSettings`. Vite tree-shaking keeps these out of the content bundle.
   - `useBlockList()` exposes: `settings`, `loaded`, `saveError`, `addKeyword`, `removeKeyword`, `addAllowKeyword`, `removeAllowKeyword`, `addCategory`, `addCategoryFromPreset`, `addCategoryFromDefault`, `removeCategory`, `setCatLabel`, `addCatKeyword`, `removeCatKeyword`. Mutators that take user-typed strings (`addKeyword`, `addCatKeyword`) return `AddKeywordResult` (`'added' | 'duplicate' | 'empty' | 'too_long'`) so the UI can render inline validation feedback. The same length caps (`MAX_KEYWORD_LEN` / `MAX_LABEL_LEN`) are also enforced inside `loadSettings` / `parseImport` filters, so corrupted storage or a malicious import can't smuggle in oversized strings.
   - `parseImport(jsonStr)` accepts either the wrapped `{ version: 1, settings }` shape or a bare settings object (back-compat) and runs the same per-field type guards as `loadSettings`. Returns `null` on any parse / shape failure — popup uses that null to show the import-error banner.
   - `mergeSettings(current, imported)` — union of `keywords` / `enabledCategories`, per-id merge of `customCategories` (current label kept on collision, keywords union), preserves current `paused` / `globalBlock` / `blockTypes` / `locale` / `theme`. Used by App.vue's import dialog when the user picks 合併.

   - **`composables/diagnostics.ts`** — the message contract between content script, popup and background (`TOGGLE_REVEAL_MESSAGE`, `DIAGNOSE_MESSAGE`, `DiagnosisReport`) plus the pure `summarizeDiagnosis()`. Like `googleTlds.ts` it deliberately **imports nothing**: it is loaded by four surfaces and by tests, and one `wxt/browser` import would drag the polyfill into pure-function tests.

   Storage key is `sib_settings` (exported as `STORAGE_KEY`); sync via `chrome.storage.sync` (~100KB quota — keep the schema small).

When adding a new block type:
- Add the field to `BlocklistSettings.blockTypes` and `DEFAULT_SETTINGS.blockTypes`.
- Add a selector branch in `collectBlockSelectors()` (page CSS, honours `hideMode`) **or** `collectAlwaysHideSelectors()` (always `display: none`, for anything that would keep loading/playing when merely blurred) **or** extend `observeAutocomplete()` if it's autocomplete-specific.
- Add the UI checkbox in `App.vue` and a label string in both `messages['zh-TW']` and `messages.en` in `entrypoints/popup/i18n.ts`. `repoConsistency.test.ts` fails if the two locales' key sets diverge.
- If it should be covered during the pre-settings window, turn it on in `INITIAL_HIDE_BLOCK_TYPES` (`selectors.test.ts` asserts the superset property against `DEFAULT_SETTINGS`).

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
5. **`useBlockList()` seeds itself from a synchronous `localStorage` mirror (`sib_settings_cache`) and starts `loaded` at `true` when that hits.** `chrome.storage.sync` is async-only and can take several hundred ms when the profile has just woken or Google is mid-sync; until it resolved the popup could only paint `載入中…`, so the whole UI appeared at once and the window visibly grew — the "popup flashes for about a second" report. `localStorage` is synchronous, so the first frame is the real screen and the storage round-trip becomes a silent reconcile.
   - **The cache belongs in `useBlockList.ts`, never in `blockList.ts`.** The content script runs in google.com's origin; writing the keyword list to `localStorage` there would hand the user's blocklist to Google's own page scripts. `pnpm build` keeping `content-scripts/content.js` at its previous size is the check that it didn't leak in.
   - The cache is read through `normalizeSettings()` — the same type guards `loadSettings` and `parseImport` use, extracted so all three share one implementation. A cache written by an older version is missing fields, and the UI must not receive `undefined`.
   - **The watcher dedupes by comparing a serialization (`lastPersisted`), not by a "currently applying remote data" flag.** Replacing `settings.value` fires the `flush: 'sync'` watcher synchronously, so without this every popup open would write back exactly what it just read — and `chrome.storage.sync` caps writes at 1800/hour, after which real setting changes start failing. The comparison also absorbs "toggled a checkbox and toggled it back".
   - **`watch(loaded, …)` in `App.vue` needs `{ immediate: true }`.** On a cache hit `loaded` never transitions, so without it the status card, storage quota and shortcut list never initialize.
   - `App.vue` mirrors the `getBytesInUse` result to `sib_storage_bytes` for the same reason: the quota bar is `v-if`-gated on it and would otherwise pop into the layout after the async call.
   - `entrypoints/popup/main.ts`'s `sib_theme` localStorage read is the same trick applied to the dark class, and predates this.
   - `composables/settingsCache.test.ts` (happy-dom) pins all of it: synchronous `loaded`, legacy-cache backfill, and "identical cache writes nothing".

## Manifest & permissions

The manifest is generated by WXT from `wxt.config.ts` — edit it there, not in `.output/`. Current permissions: `storage` only, with host permissions covering 16 Google TLDs (`com`, `com.tw`, `com.hk`, `co.jp`, `co.kr`, `com.sg`, `co.uk`, `com.au`, `ca`, `co.in`, `de`, `fr`, `es`, `it`, `com.br`, `com.mx`). `composables/googleTlds.ts` is the single source for that list. It deliberately **imports nothing** — it is loaded by Node (`wxt.config.ts`), by the popup, and by tests, and one `wxt/browser` import would crash the Node side (`webextension-polyfill` throws outside a browser). It exports `GOOGLE_TLDS`, `GOOGLE_HOST_PERMISSIONS`, `GOOGLE_SEARCH_MATCHES`, and `isGoogleSearchUrl(url)`.

The `matches: [...]` literal in `entrypoints/content/index.ts` still cannot be generated from it — WXT statically analyzes that array at build time and won't evaluate `.map()`. Instead of a comment asking you to remember, `composables/googleTlds.test.ts` reads the source file and asserts the literal equals `GOOGLE_SEARCH_MATCHES`, so drift fails the suite.

`commands` (two shortcuts: `_execute_action` = `Alt+Shift+B`, `toggle-reveal` = `Alt+Shift+S`), `background.service_worker` and `options_ui` were all added in 1.1.0. **None of them is a permission**, so the manifest still declares only `storage` + the same 16 host permissions and existing users are not prompted to re-consent. Keep it that way: adding a permission (`scripting`, `tabs`, another TLD) disables an already-published extension until the user re-approves it, and that dialog is where a batch of users leaves. That constraint is why diagnosis is a message to the content script and not `scripting.executeScript`.

`repoConsistency.test.ts` guards three cross-file invariants that used to be "remember to sync" comments: `package.json` ↔ `wxt.config.ts` version, the two `privacy.html` copies being byte-identical, and every `__MSG_*__` token in the manifest existing in both `_locales`.

Use `isGoogleSearchUrl()` for "is this tab a Google search page" — never `hostname.includes('google.com')`, which misses the 9 TLDs whose string doesn't contain `google.com` (`co.jp`, `co.kr`, `co.uk`, `ca`, `co.in`, `de`, `fr`, `es`, `it`) while also accepting `google.com.evil.example`.

**`name` / `description` / `action.default_title` use Chrome i18n `__MSG_*__` tokens** (`extName` / `extDescription`), backed by `public/_locales/{zh_TW,en}/messages.json`. `default_locale: 'zh_TW'` is the fallback. To change the user-facing extension name or short description, edit **both** locale files — not `wxt.config.ts`. WXT auto-derives `action.default_title` from the popup's `<title>`, so `entrypoints/popup/index.html` also uses `__MSG_extName__` (plus an explicit `<meta name="manifest.default_title" content="__MSG_extName__" />` to belt-and-suspenders the override).

## Build assets

- **`public/icon/*.png`** — checked into git, bundled into the .crx (anything in `public/` ships).
- **`assets/icons-source/`** — `.gitignored`, **not** bundled. Holds the SVG sources (`scope_icn.svg`, `icon.svg`) and `build.py` (renders SVG → PNG via Chrome headless + Pillow, outputs to `public/icon/`). Kept out of `public/` deliberately so end users can't extract paid-for SVG assets from the .crx. Run `python3 assets/icons-source/build.py` to regenerate PNGs.

## Privacy policy (two copies — keep in sync)

Same content lives in two places:
- `entrypoints/privacy/index.html` — bundled into the extension at build time; popup footer links to `/privacy.html` (resolves to `chrome-extension://<id>/privacy.html`).
- `privacy.html` (repo root) — served by GitHub Pages at `https://mingdajhong.github.io/search_image_blocker/privacy.html`. This is the URL filled into the Chrome Web Store listing's privacy field.

GitHub Pages source is `master /(root)`, so the root copy is what Pages picks up. When updating the policy, edit `entrypoints/privacy/index.html` first, then run `pnpm sync:privacy`. Drift is a test failure (`repoConsistency.test.ts`), not a comment you have to remember.

## Path aliases

`@/` resolves to the project root (provided by WXT's generated tsconfig). Use `@/composables/...` rather than relative paths.

## Selector 週檢（`canary/`）

`selectors.ts` 是整個專案唯一會因為**別人改東西**而壞掉的檔案，而這個產品沒有
遙測，所以 Google 改了 DOM 沒有任何自動訊號。`canary/` 就是那個訊號：每週手動
跑一次，開真的 Chrome 走過 6 個 Google 頁面，逐條數 selector 命中數，和
`canary/baseline.json` 比對。

- `canary/pages.ts` — 頁面矩陣（純資料）。選頁原則是**每一條還活著的 selector
  至少被一頁涵蓋**；`g-scrolling-carousel` 只在 `hl=en` 出現、
  `div[data-attrid*="image"]` 只在圖片分頁出現，少走一頁就會把「還活著」誤判成
  「早就死了」。
- `canary/report.ts` — 判定與報表，**純函式、被 `pnpm test` 一起守住**
  （`canary/report.test.ts`）。
- `canary/probe.ts` — 序列化後丟進頁面執行的計數函式，不能引用外部變數。
- `canary/run.canary.ts` — Playwright 驅動，由 `vitest.canary.config.ts` 執行。
- `canary/README.md` — **給人看的操作手冊**：兩個指令的差別、報告怎麼讀、六種狀態
  各代表什麼、出現 🔴 時的修復流程。使用者第一次拿到這套工具時看不懂報告，那份
  文件就是為此存在的 —— 改判定規則或報表格式時要一起更新。

**為什麼一定要真瀏覽器**：排除清單建立在 `:not(:is(cite img, …))` 上，happy-dom
不支援後代組合子而且是靜默失敗。任何在 happy-dom 裡做的命中數斷言測到的是
happy-dom，不是這個產品 —— 這也是 `selectors.test.ts` 至今只驗語法不驗命中數的原因。

**為什麼不能上 CI**：GitHub Actions 是資料中心 IP，Google 幾乎必定回驗證碼。這套
東西的設計前提是「你自己的機器、真實 profile、headed、每週一次」。搬上 CI 不會得到
自動化報告，只會得到一份每週都是 ⏭ 略過的報告。

**為什麼是比基準線而不是 `expect(count > 0)`**：2026-08-21 的首次盤點顯示，預設開啟
的 33 條 selector 裡有 23 條在 6 個真實頁面上一次都沒命中過（所有 `picture`、所有
`<video>`、所有 `[style*="background-image"]`、以及 `video-voyager` / `data-vido`
兩組舊 fallback）。硬門檻會讓每次執行都亮 23 個紅燈，兩週後就沒人看了。真正有訊息量的
是**變化**：上週還在命中、這週掉到 0。

**為什麼「歸零」本身還不足以判定失效**（v2 的核心）：第一版就是這樣寫的，同一天第二次
執行就誤報了 —— `div[data-attrid*="Video"] img`（5 → 0）與 `g-scrolling-carousel`
（1 → 0）掉到 0，但 selector 一個字都沒改。原因是 **Google 不保證同一個查詢每次都顯示
同一組模組**：知識面板的影片區、圖片輪播是否出現，隔十五分鐘就會不一樣。兩格都只在
一個頁面出現過、命中數各只有 5 和 1，用單次觀測當基準線必然誤報。

所以基準線的每一格記的是**觀測史** `{ max, seen, runs }`，不是「上次幾個」。一格要能
硬性判定失效，得先夠可信（`report.ts` 的 `isTrustworthy`）：穩定度 `seen/runs` 達
`STABLE_RATIO`(0.8)，**而且** `max >= HIGH_CONFIDENCE_MIN`(10) 或
`runs >= MIN_RUNS_FOR_HARD_FAIL`(3)。不夠可信的一格歸零只報 `flaky`（🟠），不讓指令
失敗。`#search img` 從 212 掉到 0 立刻紅燈；`g-scrolling-carousel` 從 1 掉到 0 要先
累積三次穩定觀測。代價是新的一格要跑幾次 `canary:update` 才開始把關 —— 那是誠實的，
只觀測過一次的東西本來就還不知道它穩不穩定。

其他幾個不明顯但load-bearing的點：
- 判定是**逐格（page × selector）**而不是看總數。總數 >0 只證明「還有東西在擋」；
  一條 selector 靜默失效而其他還命中，只有逐格看得到 —— 那正是 Known gaps 裡
  「partial breakage」那一條。
- 被驗證碼擋下的頁面進 `skipped`，**不參與判定，也不併進觀測史**。「沒問到」不是證據；
  算成一次「沒命中」會讓穩定度被驗證碼稀釋掉，最後把真的穩定的一格降級成 flaky。
- **只有 `canary:update` 會累積觀測史，`pnpm canary` 是唯讀的。** 如果每次執行都自動
  累積，一個真的壞掉的 selector 會因為連續幾週都是 0 而讓 `seen/runs` 一路降到門檻
  以下，然後自己變成 `dead` 不再報警 —— 那正是「靜默把機制關掉」的失敗模式。跑 update
  等於你看過報告、確認這次是正常的。
- 基準線是 v2 格式；`migrateBaseline()` 把舊的 v1（只有 counts）讀成 `runs: 1`，也就是
  「還不夠格硬性判定失效」。
- 全部頁面都被擋時**不寫基準線**。一份全空的基準線會讓下一次執行把所有東西判成
  `new`，等於靜默把這套機制關掉。
- 基準線用 `DEFAULT_SETTINGS.blockTypes`，不是全開 —— `relatedQuestions` /
  `knowledgePanel` 預設關閉，它們壞掉不影響任何沒改設定的使用者，放進來只會稀釋
  紅燈的嚴重性。代價是那 7 條沒有週檢覆蓋。
- `vitest.canary.config.ts` 的 `disableConsoleIntercept: true` 是必要的：vitest 預設
  不印**通過**的測試的 console 輸出，而這支測試的產出就是那份報告，斷言只是附帶的紅綠燈。
- 每頁之間有隨機 jitter，並且會捲動一趟再回頂讓 lazy-load 縮圖進來。不捲的話命中數
  隨視窗高度浮動，基準線就變成噪音（首次手動盤點就因為沒捲，把 `div[jsname="tX7jT"]`
  和 `div[data-attrid*="Video"]` 誤判成已死）。

`.canary-profile/` 是複製出來的 Chrome profile（gitignore），留著 consent cookie。
第一次跑如果卡在 consent 畫面，用那個 profile 手動開一次 Google 通過即可。

## Known gaps

- Google CSS selectors in `entrypoints/content/selectors.ts` need ongoing maintenance as Google rotates its DOM. The dev-only `devSelectorAudit`, the on-page indicator's "hidden 0 blocks" state, and the popup's diagnosis button all surface a *full* rotation. Partial breakage is now covered by `pnpm canary` (逐格比對，見上方「Selector 週檢」) — **但那是手動每週跑的，不是自動的**：真正壞掉到你發現之間仍有最多一週的空窗。
- 週檢只涵蓋 `DEFAULT_SETTINGS.blockTypes`（33 條）。`relatedQuestions` / `knowledgePanel` 的 7 條預設關閉、沒有基準線，壞了不會有人知道。
- 首次盤點（2026-08-21）顯示 33 條裡只有 10 條實際命中過任何東西。剩下 23 條沒有刪 —— 它們是防禦性的舊 layout fallback，成本只有幾百 bytes 的 CSS 文字 —— 但「加一條 selector」和「這條 selector 真的有用」是兩回事，新增時值得先用 canary 確認。
- **`blur` / `mask` have only been verified against synthetic fixtures rendered in a real CSS engine, never on a live Google SERP.** The visual claims hold (flat tile with no silhouette, no blur bleed), but how they read on an actual results page — and whether click-to-reveal survives Google's `jsaction` handlers in practice — is unverified. All three constants (`BLUR_RADIUS_PX`, `BLUR_CONTRAST`, `BLUR_BRIGHTNESS`) are tunable knobs in `hideStyle.ts`.
- **A6's soft-navigation path is untested against real Google.** Whether udm-tab / filter-chip switches actually go through `pushState` differs by Google version; the 500 ms poll makes the watcher correct either way, but if soft navigation never happens the whole module is dead weight.
- `blur` / `mask` let the images download. That is inherent to keeping them in the layout, and the popup hint says so, but it means those modes are strictly worse than `hide` for bandwidth and for anything that watches network activity.
- Theme is binary (light/dark only) — three-state auto-follow-OS would need a separate `prefers-color-scheme` watcher and a new `'auto'` value in `Theme`.
- The options page is a two-column version of the popup, not a differently-designed surface. It solves "managing hundreds of keywords in 360 px" (filter + bulk paste + inline exceptions) but does not add anything the popup could not show.
