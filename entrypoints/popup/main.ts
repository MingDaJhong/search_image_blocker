import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

// Mount 前同步套用 dark class，避免閃爍。
// chrome.storage.sync 是 async 沒辦法 sync 讀，所以用 localStorage 當 cache：
// - App.vue 在 settings 載入後 / theme 變動時會把值寫進 localStorage
// - 這裡同步讀 cache 就能在第一個 paint 套對顏色
// 第一次 ever 開 popup（cache 還沒寫過）才會 fallback 到 OS prefers-color-scheme
const cached = localStorage.getItem('sib_theme')
const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches
const initialDark = cached === 'dark' || (cached !== 'light' && prefersDark)
document.documentElement.classList.toggle('dark', initialDark)

createApp(App).mount('#app')
