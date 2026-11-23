// Offline UI checks: every API request is intercepted; no provider or camera is contacted.
// Set PLAYWRIGHT_MODULE and optionally PLAYWRIGHT_CHROMIUM_EXECUTABLE if not installed locally.
import assert from 'node:assert/strict';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
const base = process.env.ZENITH_UI_URL || 'http://127.0.0.1:5182';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let sent = 0, previewed = 0, telegramProbed = 0, modelUnavailable = false, unauthorized = false;
const status = {
  is_admin: true, worker_online: true, worker_age_seconds: 2,
  storage_used_mb: 12, storage_limit_mb: 500, email_mode: 'preview',
  camera: {configured: true, state: 'stopped', protocol: 'YouTube', last_clip_at: null, mode: 'bounded clips'},
  channels: {email: 'preview', telegram: {configured: true, chats: 1, evidence: true}},
  vision: {provider: 'typesafe', configured: true, available: true, model: 'jev-1.14.0', auto_limit: 3, detail: 'Configured'},
  models: {traffic: {detector: 'yolo11n.pt', tracker: 'ByteTrack'},
    action: {detector: 'Pose', classifier: 'Action classifier', checkpoint_present: false, upload_enabled: false}},
  recipients: ['telegram:123'], max_upload_mb: 100, max_video_seconds: 180,
};
await page.addInitScript(() => sessionStorage.setItem('zenith.key', 'offline-browser-test-key-long-enough'));
await page.route('**/api/**', async route => {
  const path = new URL(route.request().url()).pathname.slice(4);
  const fulfill = (body, code = 200) => route.fulfill({status: code, contentType: 'application/json', body: JSON.stringify(body)});
  if (path === '/health') return fulfill({status: 'ok', service: 'zenith'});
  if (path === '/ready') return fulfill({database: {ready: true, detail: 'Application database is reachable'}});
  if (path === '/status') return unauthorized ? fulfill({detail: 'Operator access required'}, 401) : fulfill(status);
  if (path === '/vision/status') return fulfill({...status.vision, reachable: true,
    model_access: !modelUnavailable, detail: modelUnavailable ? 'Model access denied' : 'Configured model is listed'});
  if (path === '/notifications/status') { telegramProbed++; return fulfill({reachable: true, detail: 'Bot @demo reachable'}); }
  if (path === '/notifications/test') { sent++; return fulfill({bot: 'Bot @demo reachable',
    results: [{chat: '123', delivered: true, detail: 'Telegram accepted the message; delivery not verified'}]}); }
  if (path === '/cameras/rtsp/preview') {
    previewed++;
    return route.fulfill({contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"/>'});
  }
  return fulfill([]);
});
const health = page.getByRole('region', {name: 'System health checks'});
const row = name => health.locator('.health-check-item').filter({has: page.getByText(name, {exact: true})});
try {
  await page.goto(`${base}/#settings`, {waitUntil: 'domcontentloaded'});
  await page.getByText('Connected', {exact: true}).waitFor();
  await health.getByText('Not tested yet.', {exact: false}).waitFor();
  assert.equal(sent, 0);
  await page.getByRole('button', {name: 'Run health checks', exact: true}).click();
  await health.getByText(/checks passed · checked/).waitFor();
  assert.match(await row('Backend API').innerText(), /Passed/);
  assert.match(await row('Jev / vision provider').innerText(), /Passed/);
  assert.match(await row('Telegram bot').innerText(), /Passed/);
  assert.match(await row('YouTube / camera stream').innerText(), /Needs attention/);
  assert.equal(sent, 0, 'Health checks must never send alerts');
  assert.equal(previewed, 0, 'Health checks must not capture footage without the separate action');
  await page.getByRole('button', {name: 'Check stream frame', exact: true}).click();
  await row('YouTube / camera stream').getByText('Passed', {exact: true}).waitFor();
  assert.equal(previewed, 1);
  modelUnavailable = true;
  await page.getByRole('button', {name: 'Run health checks', exact: true}).click();
  await health.getByText(/checks passed · checked/).waitFor();
  assert.match(await row('Jev / vision provider').innerText(), /Failed/);
  assert.match(await row('Backend API').innerText(), /Passed/);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', {name: 'Send test Telegram alert', exact: true}).click();
  assert.equal(sent, 0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', {name: 'Send test Telegram alert', exact: true}).click();
  await health.getByText(/Chat 123: Telegram accepted/).waitFor();
  assert.equal(sent, 1);
  console.log('PASS: independent checks, model failure, explicit stream check and Telegram send confirmation');

  status.is_admin = false;
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.getByText('Connected', {exact: true}).waitFor();
  const previousProbes = telegramProbed;
  await page.getByRole('button', {name: 'Run health checks', exact: true}).click();
  await health.getByText(/checks passed · checked/).waitFor();
  assert.equal(telegramProbed, previousProbes);
  assert.equal(await page.getByRole('button', {name: 'Send test Telegram alert', exact: true}).count(), 0);
  assert.match(await row('Telegram bot').innerText(), /administrator key/);
  console.log('PASS: operator access cannot probe or send Telegram messages');

  status.camera.configured = false;
  await page.goto(`${base}/#studio`, {waitUntil: 'domcontentloaded'});
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.getByText('Camera sources', {exact: true}).click();
  await page.getByText('No network source configured.', {exact: false}).waitFor();
  assert.equal(await page.getByRole('button', {name: 'Preview stream', exact: true}).isEnabled(), false);
  console.log('PASS: unconfigured stream exposes setup instructions, not hidden controls');

  unauthorized = true;
  await page.goto(`${base}/#settings`, {waitUntil: 'domcontentloaded'});
  await page.reload({waitUntil: 'domcontentloaded'});
  await page.getByRole('button', {name: 'Run health checks', exact: true}).click();
  await health.getByText(/checks passed · checked/).waitFor();
  assert.match(await row('Backend API').innerText(), /Passed/);
  assert.match(await row('Analysis worker').innerText(), /Operator access required/);
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
  assert.deepEqual(errors, []);
  console.log('PASS: disconnected diagnostics, mobile layout, no runtime errors');
} catch (error) {
  console.error('Browser errors:', errors);
  console.error((await page.locator('main').innerText()).slice(0, 10000));
  throw error;
} finally {
  await browser.close();
}
