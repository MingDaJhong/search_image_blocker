// @vitest-environment happy-dom
/**
 * 頁面提示計數觀察器的測試。
 *
 * 這個模組取代的是兩個固定時間點的 `setTimeout` 補數 —— 它們追不上 Google
 * 「捲到才載」的縮圖。所以這裡測的正是那個差別：**節點是什麼時候進來的**
 * 不重要，進來就會被通知；以及它該有的節制（debounce 合併、拆掉就安靜）。
 *
 * 這裡不斷言命中數，只斷言「有沒有被通知」—— happy-dom 的 selector 行為
 * 跟真 Chrome 不一樣（見 CLAUDE.md），數字要在真瀏覽器上才有意義。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchBlockedCount, type BlockCountWatcher } from './blockCount'

/** debounce 是 300 ms，等久一點避免測試在慢機器上飄 */
const settle = () => new Promise((r) => setTimeout(r, 420))

let watcher: BlockCountWatcher | null = null

afterEach(() => {
  watcher?.disconnect()
  watcher = null
  document.body.innerHTML = ''
})

function mountSearchPage() {
  document.body.innerHTML = '<div id="search"><div id="results"></div></div>'
  return document.getElementById('results')!
}

describe('watchBlockedCount', () => {
  it('結果區長出新節點後會通知', async () => {
    const results = mountSearchPage()
    const onChange = vi.fn()
    watcher = watchBlockedCount(onChange)

    // 模擬捲動後才載進來的縮圖
    results.appendChild(document.createElement('img'))
    await settle()

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('連續變動只通知一次（debounce）', async () => {
    const results = mountSearchPage()
    const onChange = vi.fn()
    watcher = watchBlockedCount(onChange)

    // Google 串流結果時一次會塞進來一整批
    for (let i = 0; i < 10; i++) results.appendChild(document.createElement('img'))
    await settle()

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('第一批安定之後，第二批仍然會通知', async () => {
    const results = mountSearchPage()
    const onChange = vi.fn()
    watcher = watchBlockedCount(onChange)

    results.appendChild(document.createElement('img'))
    await settle()
    // 這一批就是原本兩個 setTimeout 追不到的那種：使用者捲下去才發生
    results.appendChild(document.createElement('img'))
    await settle()

    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('disconnect 之後不再通知', async () => {
    const results = mountSearchPage()
    const onChange = vi.fn()
    watcher = watchBlockedCount(onChange)
    watcher.disconnect()
    watcher = null

    results.appendChild(document.createElement('img'))
    await settle()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('已排程但還沒觸發時 disconnect，那次也要取消', async () => {
    // 使用者在 debounce 視窗內按下「本頁顯示」——
    // 提示已經被拆掉了，回呼還去更新它就是對著 null 操作
    const results = mountSearchPage()
    const onChange = vi.fn()
    watcher = watchBlockedCount(onChange)

    results.appendChild(document.createElement('img'))
    watcher.disconnect()
    watcher = null
    await settle()

    expect(onChange).not.toHaveBeenCalled()
  })

  it('找不到結果容器時退回 body，照樣通知', async () => {
    // Google 串流得慢的時候 #search / #rcnt / #center_col 都還不存在。
    // 掃太多遠比完全不掃安全 —— 與 resultScanner 的 resultRoots() 同一個取捨。
    document.body.innerHTML = '<div id="something-else"></div>'
    const onChange = vi.fn()
    watcher = watchBlockedCount(onChange)

    document.getElementById('something-else')!.appendChild(document.createElement('img'))
    await settle()

    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
