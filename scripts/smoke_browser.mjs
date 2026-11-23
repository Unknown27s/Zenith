// Run with Vite on http://127.0.0.1:5178 and Playwright available.
// Optional: ZENITH_UI_URL, PLAYWRIGHT_MODULE (absolute module path), PLAYWRIGHT_CHROMIUM_EXECUTABLE.
// All API/camera calls are mocked. This never connects to a private database or real camera.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
const base = process.env.ZENITH_UI_URL || 'http://127.0.0.1:5178';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const postedRules = [];
const sources = [{id: 'sample', name: 'Synthetic source', duration: 5, width: 640, height: 360, input_type: 'uploaded'}];
const status = {camera: {configured: true, state: 'stopped', protocol: 'RTSP', last_clip_at: null},
  worker_online: true, recipients: [], max_upload_mb: 100, max_video_seconds: 180,
  vision: {provider: 'off', available: false, detail: 'Disabled'}, is_admin: false};
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url());
  const path = url.pathname.slice(4);
  if (path.endsWith('/preview')) return route.fulfill({contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#263e32"/></svg>'});
  if (path === '/cameras/rtsp/start') postedRules.push(route.request().postDataJSON().rule);
  const body = path === '/status' ? status : path === '/sources' ? sources : path === '/local-session' ? {status: 'connected'} : [];
  return route.fulfill({contentType: 'application/json', body: JSON.stringify(body)});
});

try {
  await page.goto(`${base}/#studio`);
  await page.getByLabel('Capability', {exact: true}).selectOption('traffic');
  await page.getByRole('option', {name: /Synthetic source/}).waitFor({state: 'attached'});
  await page.getByRole('button', {name: 'Preview stream', exact: true}).click();
  await page.getByAltText('Current network stream frame').waitFor();
  const start = page.getByRole('button', {name: 'Start stream analysis', exact: true});
  assert.equal(await start.isEnabled(), false, 'Uploaded-video geometry must not authorize a stream');
  await page.getByText('Edit stream coordinates with keyboard', {exact: true}).click();
  await page.getByLabel('Stream coordinates', {exact: true}).fill('0.2, 0.3\n0.8, 0.7');
  await page.getByLabel('Stream coordinates', {exact: true}).press('Tab');
  const confirmation = page.getByLabel('I reviewed this stream’s geometry, the selected rule settings and notification recipient.');
  await confirmation.check();
  assert.equal(await start.isEnabled(), true);
  await page.getByLabel('Detection confidence', {exact: true}).fill('0.4');
  assert.equal(await confirmation.isChecked(), false, 'Changed rule settings must invalidate stream approval');
  assert.equal(await start.isEnabled(), false);
  await confirmation.check();
  await page.getByRole('button', {name: 'Clear', exact: true}).click();
  assert.equal(await confirmation.isChecked(), true, 'Uploaded-video edits must not overwrite stream geometry');
  await start.click();
  await page.getByRole('status').filter({hasText: 'Stream capture started.'}).waitFor();
  assert.deepEqual(postedRules[0].points, [[.2, .3], [.8, .7]]);
  assert.equal(postedRules[0].confirmed, true);
  assert.equal(postedRules[0].confidence, .4);
  console.log('PASS: separate stream geometry, approval invalidation and submitted rule');

  await page.evaluate(() => {
    window.stoppedTracks = 0;
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => {
      window.finishCameraPermission = () => resolve({getTracks: () => [{stop: () => {window.stoppedTracks += 1;}}]});
    });
  });
  await page.getByRole('button', {name: 'Open camera', exact: true}).click();
  await page.getByRole('button', {name: 'Waiting for camera permission…', exact: true}).waitFor();
  await page.evaluate(() => { location.hash = 'overview'; });
  await page.getByRole('heading', {name: 'See what matters. Act with confidence.', exact: true}).waitFor();
  await page.evaluate(() => window.finishCameraPermission());
  await page.waitForFunction(() => window.stoppedTracks === 1);
  console.log('PASS: delayed camera permission releases tracks after Studio unmounts');
  assert.deepEqual(errors, []);
  console.log('PASS: no browser runtime errors');
} finally {
  await browser.close();
}
