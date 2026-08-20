/**
 * Background service worker —— 只做一件事：把鍵盤快捷鍵轉給 content script。
 *
 * `_execute_action`（開啟 popup）由 Chrome 自己處理，不需要任何程式碼。真正
 * 需要中介的是「本頁顯示 / 復原」：那個狀態活在 content script 的 closure 裡
 * （刻意不持久化，見 indicator.ts），所以只能用訊息去戳它。
 *
 * 沒有新增任何權限：`commands` 是 manifest 欄位而不是 permission，而
 * `tabs.sendMessage` 對已經有 host permission 的網域本來就能用。對已上架的
 * 擴充功能新增權限會讓 Chrome 停用它直到使用者重新同意 —— 那是實質的留存風險。
 */
import { defineBackground } from "wxt/sandbox";
import { browser } from "wxt/browser";
import { TOGGLE_REVEAL_MESSAGE } from "@/composables/diagnostics";

export default defineBackground(() => {
  browser.commands?.onCommand.addListener(async (command) => {
    if (command !== "toggle-reveal") return;
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab?.id) return;
    try {
      await browser.tabs.sendMessage(tab.id, { type: TOGGLE_REVEAL_MESSAGE });
    } catch {
      // 這個分頁沒有 content script（非搜尋頁，或安裝前就開著的分頁）—— 忽略
    }
  });
});
