/* 実走検証 1: 起動 + 初期レイアウト + コンソールエラー収集 + スクリーンショット */
import { chromium } from 'playwright-core'

const SCRATCH = new URL('./out', import.meta.url).pathname

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })

const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// パネルタブの存在確認
for (const name of ['Hierarchy', 'Scene', 'Inspector', 'Project', 'Console']) {
  const count = await page.getByText(name, { exact: true }).count()
  console.log(`tab ${name}: ${count > 0 ? 'OK' : 'MISSING'}`)
}
// Hierarchy 初期ノード
for (const name of ['Main Camera', 'Directional Light']) {
  const count = await page.getByText(name, { exact: true }).count()
  console.log(`node ${name}: ${count > 0 ? 'OK' : 'MISSING'}`)
}
// canvas が存在するか
console.log('canvas count:', await page.locator('canvas').count())

await page.screenshot({ path: `${SCRATCH}/shot-initial.png` })
console.log('console errors:', errors.length === 0 ? 'none' : errors.slice(0, 10))
await browser.close()
