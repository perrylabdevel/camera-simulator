// Runs a JS snippet in the loaded app and prints its JSON result.
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';
const code = await readFile(process.argv[2], 'utf8');
const server = await createServer({ server: { port: 5196 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 600, height: 400 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(server.resolvedUrls.local[0] + '?quality=low');
await page.waitForFunction(() => window.cameraApp, null, { timeout: 180000 });
console.log(JSON.stringify(await page.evaluate(code), null, 1));
await browser.close();
await server.close();
