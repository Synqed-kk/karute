import { chromium } from 'playwright'

const OUT = '/tmp/claude-501/-Users-liam/0ef85bb4-2c16-4640-bd10-c021c50ad60f/scratchpad'
const logs = []
const browser = await chromium.launch({ channel: 'chrome' })

async function shoot(width, tag) {
  const page = await browser.newPage({ viewport: { width, height: 900 } })
  page.on('console', (m) => logs.push(`[${tag}][console.${m.type()}] ${m.text()}`))
  page.on('pageerror', (e) => logs.push(`[${tag}][pageerror] ${e.message}`))
  await page.goto('http://localhost:8799/', { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT}/render-${tag}.png`, fullPage: true })
  await page.close()
}

await shoot(1280, 'desktop-1280')
await shoot(393, 'mobile-393')
await browser.close()

console.log(logs.join('\n'))
console.log('\nDONE')
