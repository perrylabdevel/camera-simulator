// Captures several photos in one browser session. Usage:
//   node scripts/views.mjs views.json
// views.json: [{ "name": "...", "settings": {...}, "pre": "js using app" }]
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve('screenshots');
await mkdir(outDir, { recursive: true });
const views = JSON.parse(await readFile(process.argv[2], 'utf8'));
const server = await createServer({ server: { port: 5197 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(server.resolvedUrls.local[0] + `?quality=${process.env.QUALITY ?? 'low'}`);
await page.waitForFunction(() => window.cameraApp, null, { timeout: 180000 });
for (const v of views) {
  const bytes = await page.evaluate(async (v) => {
    const app = window.cameraApp;
    app.ui.freeze = true;
    if (v.pre) await eval(v.pre);
    app.change(v.settings ?? {});
    await new Promise((r) => setTimeout(r, 300));
    await app.shoot();
    const last = app.gallery.photos.at(-1);
    return Array.from(new Uint8Array(await (await fetch(last.url)).arrayBuffer()));
  }, v);
  await writeFile(path.join(outDir, `${v.name}.jpg`), Buffer.from(bytes));
  console.log('saved', v.name);
}
await browser.close();
await server.close();
