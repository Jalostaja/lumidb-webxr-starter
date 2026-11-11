// Smoke test: load a tileset in an emulated Quest 3, enter VR, fly, scale, reset.
// Saves a screenshot after each step to test/screenshots/ and fails on console
// errors, 401/403s, CORS errors or failed requests.
//
//   LUMIDB_API_KEY=… LUMIDB_TILESET_LINK='https://…/tables/3d_tileset?p=…' npm test
//   (or LUMIDB_TABLE=… LUMIDB_BOUNDARY_PROJ=… instead of a link)
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'test', 'screenshots');
const key = process.env.LUMIDB_API_KEY;
if (!key) { console.error('Set LUMIDB_API_KEY.'); process.exit(2); }

let link = process.env.LUMIDB_TILESET_LINK;
if (!link) {
  const table = process.env.LUMIDB_TABLE, proj = process.env.LUMIDB_BOUNDARY_PROJ;
  if (!table || !proj) { console.error('Set LUMIDB_TILESET_LINK, or LUMIDB_TABLE and LUMIDB_BOUNDARY_PROJ.'); process.exit(2); }
  const base = process.env.LUMIDB_API_BASE || 'https://api.lumidb.com/api';
  link = `${base}/tables/3d_tileset?p=${encodeURIComponent(Buffer.from(JSON.stringify({ table_name: table, boundary_proj: proj })).toString('base64'))}`;
}

// Tiny static file server (no dependencies).
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://x').pathname;
    const body = await readFile(join(root, path === '/' ? 'index.html' : path));
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;

await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();

const problems = [];
const lumidb = (u) => u.includes('lumidb.com');
page.on('console', (m) => {
  if (m.type() === 'error' || /CORS|Access-Control/i.test(m.text())) problems.push(`console ${m.type()}: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`request failed: ${r.url().slice(0, 120)} (${r.failure()?.errorText})`));
page.on('response', (r) => { if (r.status() === 401 || r.status() === 403) problems.push(`${r.status()} from ${r.url().slice(0, 120)}`); });

const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['ok', name]); console.log('✓', name); }
  catch (e) { results.push(['FAIL', name]); problems.push(`${name}: ${e.message}`); console.log('✗', name, '-', e.message); }
  await page.screenshot({ path: join(shots, `${String(results.length).padStart(2, '0')}-${name.replace(/\W+/g, '-')}.png`) });
};
const app = () => page.evaluate(() => window.__app.state());
const wait = (ms) => page.waitForTimeout(ms);
const near = (a, b) => Math.hypot(...a.map((v, i) => v - b[i]));

await page.goto(`${origin}/index.html?emulate=quest#${new URLSearchParams({ link, key })}`);

await step('load tileset', async () => {
  await page.waitForFunction(() => (window.__app?.state().points ?? 0) > 0, null, { timeout: 90000 });
  const s = await app();
  console.log(`  table ${s.table}, ${s.points} points drawn, ${s.loaded} loaded`);
  if (!s.extent) throw new Error('no root extent');
});
await wait(4000);   // let it refine
await step('refined', async () => {
  const s = await app();
  console.log(`  ${s.points} points drawn, ${s.loaded} loaded`);
  if (s.points < 1000) throw new Error(`only ${s.points} points`);
});

await step('enter VR', async () => {
  await page.waitForSelector('#enter-vr', { state: 'visible', timeout: 10000 });
  await page.click('#enter-vr');
  await page.waitForFunction(() => window.__app?.state().inXR === true, null, { timeout: 15000 });
  await wait(1500);
});

let before;
await step('fly forward (left stick)', async () => {
  before = await app();
  await page.evaluate(() => window.__xrDevice.controllers.left.updateAxes('thumbstick', 0, -1));
  await wait(2000);
  await page.evaluate(() => window.__xrDevice.controllers.left.updateAxes('thumbstick', 0, 0));
  const after = await app();
  const d = near(before.rig, after.rig);
  console.log(`  rig moved ${d.toFixed(2)} m, ${after.points} points`);
  if (d < 0.2) throw new Error('rig did not move');
});

await step('fly forward (keyboard W)', async () => {
  before = await app();
  await page.keyboard.down('KeyW');
  await wait(1500);
  await page.keyboard.up('KeyW');
  const after = await app();
  const d = near(before.rig, after.rig);
  console.log(`  rig moved ${d.toFixed(2)} m`);
  if (d < 0.2) throw new Error('W did not move the rig in VR');
});

await step('scale with both grips', async () => {
  before = await app();
  await page.evaluate(() => {
    const { left, right } = window.__xrDevice.controllers;
    left.position.set(-0.15, 1.2, -0.4); right.position.set(0.15, 1.2, -0.4);
  });
  await wait(500);
  await page.evaluate(() => {
    const { left, right } = window.__xrDevice.controllers;
    left.updateButtonValue('squeeze', 1); right.updateButtonValue('squeeze', 1);
  });
  await wait(500);
  await page.evaluate(() => {
    const { left, right } = window.__xrDevice.controllers;
    left.position.set(-0.45, 1.2, -0.4); right.position.set(0.45, 1.2, -0.4);   // hands apart = world grows
  });
  await wait(1000);
  const after = await app();
  console.log(`  scale ${before.scale.toFixed(2)} -> ${after.scale.toFixed(2)}`);
  if (!(after.scale < before.scale * 0.7)) throw new Error('world did not scale');
  await page.evaluate(() => {
    const { left, right } = window.__xrDevice.controllers;
    left.updateButtonValue('squeeze', 0); right.updateButtonValue('squeeze', 0);
  });
  await wait(500);
});

await step('reset (A button)', async () => {
  await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue('a-button', 1));
  await wait(500);
  await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue('a-button', 0));
  const s = await app();
  console.log(`  scale ${s.scale.toFixed(2)}`);
  if (Math.abs(s.scale - s.extent.radius * 2 / 1.2) > 0.01 * s.scale) throw new Error('not back at the overview scale');
});

await step('VR panel click (trigger on a button)', async () => {
  before = await app();
  // Park the panel straight ahead, aim the right controller at its middle, pull the trigger.
  await page.evaluate(() => { const p = window.__app.panel; p.userData.saved = p.position.clone(); p.rotation.set(0, 0, 0); p.position.set(0, 1.6, -0.6);
    const c = window.__xrDevice.controllers.right; c.position.set(0, 1.6, -0.1); c.quaternion.set(0, 0, 0, 1); });
  await wait(600);
  await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue('trigger', 1));
  await wait(300);
  await page.evaluate(() => window.__xrDevice.controllers.right.updateButtonValue('trigger', 0));
  await wait(600);
  const after = await app();
  console.log(`  point size ${before.size} -> ${after.size}`);
  if (!(after.size > before.size)) throw new Error('panel click did not register');
});

const final = await app();
console.log(`fps ~${final.fps.toFixed(0)} (software GL, not representative), ${final.points} points drawn`);
await browser.close();
server.close();

if (problems.length) {
  console.error('\nPROBLEMS:\n' + [...new Set(problems)].map((p) => ' - ' + p).join('\n'));
  process.exit(1);
}
console.log('\nsmoke test passed');
