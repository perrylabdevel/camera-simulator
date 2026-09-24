/**
 * Automated visual check: starts the Vite dev server, loads the simulator in
 * headless Chromium, runs a scripted sequence and saves screenshots/photos to
 * ./screenshots. Cross-platform (Node only).
 *
 *   npm run shots                 # default sequence
 *   CHROME_PATH=/path/to/chrome npm run shots
 */

import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const outDir = path.resolve('screenshots');
await mkdir(outDir, { recursive: true });

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];
  return candidates.find((c) => existsSync(c));
}

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({
  executablePath: findChrome(),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => console.log('[page]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

try {
  await page.goto(url);
  await page.waitForFunction(() => window.cameraApp, null, { timeout: 180000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, 'ui.png'), timeout: 180000 });

  // Freeze the world at a moment when the cyclist passes behind the subject, slightly to the right.
  await page.evaluate(() => {
    const app = window.cameraApp;
    app.ui.freeze = true;
    let best = 0;
    let bestD = Infinity;
    for (let t = 0; t < 20; t += 0.05) {
      app.seek(t);
      const p = app.lab.cyclist.root.position;
      const d = Math.hypot(p.x - 1.6, p.z + 4.5);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    app.seek(best);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'ui-cyclist.png'), timeout: 180000 });

  const steps = process.argv.slice(2).length ? process.argv.slice(2) : ['A', 'B', 'C'];
  const presets = {
    // From the handoff's "definition of a good early build".
    A: { lensId: '85-f1.4', focalLengthMm: 85, apertureNominal: 1.4, shutterNominal: 1 / 1000, isoNominal: 100 },
    B: { lensId: '24-f2.8', focalLengthMm: 24, apertureNominal: 8, shutterNominal: 1 / 30, isoNominal: 100 },
    C: { lensId: '50-f1.8', focalLengthMm: 50, apertureNominal: 4, shutterNominal: 1 / 500, isoNominal: 3200 },
  };
  for (const name of steps) {
    const p = presets[name];
    if (!p) continue;
    const photo = await page.evaluate(async (settings) => {
      const app = window.cameraApp;
      app.change(settings);
      await new Promise((r) => setTimeout(r, 500));
      await app.shoot();
      const photos = app.gallery.photos;
      const last = photos[photos.length - 1];
      const blob = await (await fetch(last.url)).blob();
      const buf = new Uint8Array(await blob.arrayBuffer());
      return { bytes: Array.from(buf), notes: last.notes.map((n) => `${n.level}: ${n.text}`), meta: last.meta };
    }, p);
    await writeFile(path.join(outDir, `photo-${name}.jpg`), Buffer.from(photo.bytes));
    console.log(`\nPhoto ${name}:`, JSON.stringify({ ...photo.meta, takenAt: undefined }));
    for (const n of photo.notes) console.log('  -', n);
  }
  await page.screenshot({ path: path.join(outDir, 'ui-after.png'), timeout: 180000 });
} finally {
  await browser.close();
  await server.close();
}
