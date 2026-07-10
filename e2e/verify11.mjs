/* 実走検証 11: オーディオ — AudioSource (playOnAwake/loop/spatial/volume live) + ctx.playSound + 停止破棄 (D-032) */
import { chromium } from 'playwright-core'
const SCRATCH = new URL('./out', import.meta.url).pathname
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const check = (label, cond) => console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}`)

await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2000)

/* --- 1. WAVインポート --- */
await page.locator('input[type=file][accept*="wav"]').setInputFiles([`${SCRATCH}/test-tone.wav`])
await page.waitForTimeout(600)
const assetOk = await page.evaluate(() => {
  const a = window.__store.getState().assets.find((x) => x.name === 'test-tone.wav')
  return a?.type === 'audio'
})
check('WAV import → audio asset', assetOk)

/* --- 2. AudioSource (playOnAwake, loop, spatial) + playSoundスクリプト --- */
await page.evaluate(async () => {
  const scene = await import('/src/types/scene.ts')
  const store = await import('/src/store/editorStore.ts')
  const st = store.useEditorStore.getState()
  const tone = st.assets.find((a) => a.type === 'audio')

  const speaker = store.makePrimitiveNode('box')
  speaker.name = 'Speaker'
  speaker.components.push({ ...scene.defaultAudioSource(), assetId: tone.id, loop: true, volume: 0.8 })
  speaker.components.push({
    ...scene.defaultScript('Sfx'),
    code: `
let done = false
function onUpdate(ctx, dt) {
  if (!done && ctx.time.elapsed > 0.5) {
    done = true
    ctx.playSound('test-tone.wav', 0.5)
    ctx.log('oneshot-fired')
    ctx.node.getComponent('audiosource').volume = 0.3
    ctx.log('volume-set')
  }
}
`,
    props: {},
  })
  st.execute(store.cmdAddObject([speaker], null))
  st.select([])
})
await page.waitForTimeout(200)

/* --- 3. Inspectorセクション確認 --- */
await page.evaluate(() => {
  const st = window.__store.getState()
  const sp = Object.values(st.scene.nodes).find((n) => n.name === 'Speaker')
  st.select([sp.id])
})
await page.waitForTimeout(250)
check('Audio Source section in Inspector', (await page.getByText('Audio Source', { exact: true }).count()) > 0)
check('AudioClip / Volume / Play On Awake rows', (await page.getByText('AudioClip', { exact: true }).count()) > 0 && (await page.getByText('Play On Awake', { exact: true }).count()) > 0)

/* --- 4. 再生: playOnAwakeで鳴り、liveでvolume反映、one-shotも発火 --- */
await page.getByTitle('Play', { exact: true }).click()
await page.waitForTimeout(1500)
const playState = await page.evaluate(() => {
  const st = window.__store.getState()
  const sp = Object.values(st.scene.nodes).find((n) => n.name === 'Speaker')
  const am = window.__engine.audioManager
  const active = am.isPlaying(sp.id)
  // activeソースの実volume (three Audio.getVolume)
  const src = am.active.get(sp.id)
  return {
    activeCount: am.activeCount,
    playing: active,
    volume: src ? src.sound.getVolume() : -1,
    logs: st.logs.map((l) => l.message),
    ctxState: am.listener.context.state,
  }
})
check(`playOnAwake source active (count=${playState.activeCount}, state=${playState.ctxState})`, playState.activeCount === 1 && playState.playing)
check('ctx.playSound one-shot fired', playState.logs.some((m) => m.includes('oneshot-fired')))
check(`getComponent volume write → live (${playState.volume})`, Math.abs(playState.volume - 0.3) < 0.01)

/* --- 5. 停止で全破棄 --- */
await page.getByTitle('Stop', { exact: true }).click()
await page.waitForTimeout(400)
const afterStop = await page.evaluate(() => window.__engine.audioManager.activeCount)
check('stop disposes all audio sources', afterStop === 0)

console.log('page errors:', errors.length === 0 ? 'none' : errors)
await browser.close()
