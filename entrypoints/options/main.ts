/**
 * 獨立設定頁（B6）。
 *
 * 掛的是**同一個** App.vue，只是把 `wide` 打開 —— 360 px 的 popup 管幾百個
 * 關鍵字很痛，但那是版面問題，不是功能問題。複製一份 OptionsApp.vue 出來
 * 會讓兩邊立刻開始漂移（少加一個開關、少一條 i18n），而這個專案已經用
 * KeywordSection 證明過「同一段互動只留一份實作」是對的。
 */
import { createApp } from 'vue'
import App from '../popup/App.vue'
import '../popup/style.css'

// 與 popup 相同的防閃爍手法：chrome.storage 是 async，先同步讀 localStorage cache
const cached = localStorage.getItem('sib_theme')
const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
const initialDark = cached === 'dark' || (cached !== 'light' && prefersDark)
document.documentElement.classList.toggle('dark', initialDark)

createApp(App, { wide: true }).mount('#app')
