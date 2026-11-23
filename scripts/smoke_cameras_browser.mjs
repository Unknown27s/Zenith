// All APIs are mocked. This exercises camera UI only; it never contacts YouTube or Telegram.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
const base = process.env.ZENITH_UI_URL || 'http://127.0.0.1:5184';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const cameras = [];
const rules = [];
let liveStarts = 0, frameRequests = 0;
const status = {camera_inputs_supported: true, is_admin: true, worker_online: true, worker_age_seconds: 1, recipients: ['telegram:123'],
  max_upload_mb: 100, max_video_seconds: 180, camera: {configured: false, state: 'stopped', last_clip_at: null},
  vision: {provider: 'off', configured: false, available: false}, models: {traffic: {detector: 'yolo11n.pt', tracker: 'ByteTrack'},
    action: {checkpoint_present: false, upload_enabled: false}}};
await page.addInitScript(() => sessionStorage.setItem('zenith.key', 'offline-cameras-key-at-least-24-characters'));
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname.slice(4);
  const fulfill = body => route.fulfill({contentType: 'application/json', body: JSON.stringify(body)});
  if (path === '/status') return fulfill(status);
  if (path === '/cameras') {
    if (route.request().method() === 'POST') {
      const input = route.request().postDataJSON();
      const camera = {id: `camera-${cameras.length+1}`, ...input,
        health: {configured: true, protocol: 'YouTube', state: 'stopped', active: false, last_clip_at: null},
        live: {state: 'stopped', active: false}};
      cameras.push(camera);
      return fulfill(camera);
    }
    return fulfill(cameras);
  }
  const match = path.match(/^\/cameras\/([^/]+)\/(.+)$/);
  if (match) {
    const camera = cameras.find(item => item.id === match[1]);
    assert.ok(camera);
    const action = match[2];
    if (action === 'live/start') { liveStarts++; camera.live = {state: 'running', active: true, detections: 2}; return fulfill(camera.live); }
    if (action === 'live/stop') { camera.live = {state: 'stopped', active: false}; return fulfill(camera.live); }
    if (action === 'live/frame' || action === 'preview') {
      if (action === 'live/frame') frameRequests++;
      return route.fulfill({contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect x="100" y="100" width="150" height="120" fill="none" stroke="green"/></svg>'});
    }
    if (action === 'start') {
      camera.last_rule = route.request().postDataJSON().rule;
      rules.push({camera: camera.id, rule: camera.last_rule});
      camera.health = {...camera.health, state: 'capturing', active: true};
      return fulfill(camera.health);
    }
    if (action === 'stop') { camera.health = {...camera.health, state: 'stopped', active: false}; return fulfill(camera.health); }
  }
  return fulfill([]);
});

async function add(name, url) {
  await page.getByLabel('Camera name', {exact: true}).fill(name);
  await page.getByLabel('YouTube livestream URL', {exact: true}).fill(url);
  await page.getByLabel('I have permission to process this stream and share evidence with the selected alert recipients.', {exact: true}).check();
  await page.getByRole('button', {name: 'Save camera & open', exact: true}).click();
  await page.getByRole('heading', {name, exact: true}).waitFor();
}
async function confirmRule(name, coordinates) {
  await page.getByLabel('Rule name', {exact: true}).fill(name);
  await page.getByRole('button', {name: 'Preview stream', exact: true}).click();
  await page.getByAltText('Current network stream frame', {exact: true}).waitFor();
  await page.getByText('Edit stream coordinates with keyboard', {exact: true}).click();
  await page.getByLabel('Stream coordinates', {exact: true}).fill(coordinates);
  await page.getByLabel('Stream coordinates', {exact: true}).press('Tab');
  await page.getByLabel('I reviewed the stream preview, settings and notification recipients.', {exact: true}).check();
  await page.getByRole('button', {name: 'Start stream analysis', exact: true}).click();
}

try {
  await page.goto(`${base}/#cameras`, {waitUntil: 'domcontentloaded'});
  await page.getByRole('button', {name: 'Save camera & open', exact: true}).waitFor();
  await add('Entrance', 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(liveStarts, 0);
  await page.getByLabel('I have permission to process this livestream.', {exact: true}).check();
  await page.getByRole('button', {name: 'Start YOLO preview', exact: true}).click();
  await page.getByAltText('YOLO detections from Entrance', {exact: true}).waitFor();
  assert.equal(liveStarts, 1);
  assert.ok(frameRequests > 0);
  assert.equal(rules.length, 0, 'Starting YOLO preview must not silently start alerts');
  await confirmRule('Entrance zone', '0.1,0.1\n0.9,0.1\n0.9,0.9');
  assert.equal(rules[0].camera, 'camera-1');
  assert.equal(rules[0].rule.capability, 'zone');
  await page.getByRole('link', {name: '← All cameras', exact: true}).click();
  await add('Road', 'https://www.youtube.com/watch?v=abcdefghijl');
  await page.getByLabel('Monitoring type', {exact: true}).selectOption('traffic');
  await confirmRule('Road line', '0.1,0.5\n0.9,0.5');
  assert.equal(rules[1].camera, 'camera-2');
  assert.equal(rules[1].rule.capability, 'traffic');
  assert.equal(cameras[0].last_rule.name, 'Entrance zone');
  assert.equal(cameras[1].last_rule.name, 'Road line');
  console.log('PASS: direct URL saving, separate camera page, same-frame preview requests and independent camera rules');

  await page.goto(`${base}/#cameras/camera-1`, {waitUntil: 'domcontentloaded'});
  await page.getByRole('heading', {name: 'Entrance', exact: true}).waitFor();
  assert.equal(await page.getByLabel('Rule name', {exact: true}).inputValue(), 'Entrance zone');
  await page.getByRole('button', {name: 'Stop stream', exact: true}).click();
  assert.equal(cameras[0].health.active, false);
  assert.equal(cameras[1].health.active, true);
  await page.getByRole('button', {name: 'Stop YOLO preview', exact: true}).click();
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1), false);
  assert.deepEqual(errors, []);
  console.log('PASS: saved-rule restoration, camera-specific stop, responsive layout and no runtime errors');
  status.camera_inputs_supported = false;
  await page.goto(`${base}/#cameras`, {waitUntil: 'domcontentloaded'});
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.getByText('Backend update required—not a YouTube URL error.', {exact: true}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Save camera & open', exact: true}).isEnabled(), false);
  console.log('PASS: old backend shows restart instructions instead of accepting a broken camera submission');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error((await page.locator('main').innerText()).slice(0, 10000));
  throw error;
} finally {
  await browser.close();
}
