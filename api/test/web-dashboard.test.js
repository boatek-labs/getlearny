import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const webDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const appHtml = readFileSync(join(webDir, 'app.html'), 'utf8').replace(/<script[^>]*src=[^>]*><\/script>/g, '');
const appJs = readFileSync(join(webDir, 'app.js'), 'utf8');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// Loads the real dashboard shell and app.js in jsdom. `routes` maps API paths to
// responses that exist only inside this test; production code never sees them.
async function boot({ token = '', routes = {} } = {}) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(String(e.detail?.message || e.message)));
  const dom = new JSDOM(appHtml, { url: 'https://getlearny.test/app', runScripts: 'outside-only', virtualConsole, pretendToBeVisual: true });
  const w = dom.window;
  if (token) w.localStorage.setItem('gl_token', token);
  const requests = [];
  w.fetch = async (url, opts = {}) => {
    const path = String(url).replace(/^.*\/api\/v1/, '');
    requests.push({ path, auth: opts.headers?.Authorization || '' });
    const handler = routes[path];
    if (!handler) return json(404, { error: 'Not found' });
    if (handler instanceof Error) throw handler;
    return handler;
  };
  Object.defineProperty(w.navigator, 'serviceWorker', { value: { register: async () => ({}), ready: new Promise(() => {}) }, configurable: true });
  try { w.eval(appJs); } catch (e) { errors.push('THROWN: ' + e.message); }
  await new Promise(resolve => setTimeout(resolve, 300));
  const text = sel => w.document.querySelector(sel)?.textContent;
  return { w, errors, requests, text, dom };
}

const healthy = json(200, { status: 'ok', database: { connected: true } });

test('dashboard script finishes startup without throwing (regression: $ used as a list)', async () => {
  const { errors } = await boot({ routes: { '/health': healthy } });
  assert.deepEqual(errors, []);
});

test('signed-out visitor leaves "Connecting…" and sees an accurate signed-out state', async () => {
  const { text, requests } = await boot({ routes: { '/health': healthy } });
  assert.equal(text('#connection'), 'Online · sign in to sync');
  assert.deepEqual(requests.map(r => r.path), ['/health']);
});

test('navigation buttons are wired up after startup', async () => {
  const { w } = await boot({ routes: { '/health': healthy } });
  w.document.querySelector('.nav-item[data-view="journal"]').click();
  assert.equal(w.document.querySelector('#crumb').textContent, 'Learning journal');
});

test('mobile navigation panel opens and lists every section', async () => {
  const { w, errors } = await boot({ routes: { '/health': healthy } });
  w.document.querySelector('#mobile-menu-toggle').click();
  assert.deepEqual(errors, []);
  assert.ok(w.document.body.classList.contains('navigation-orbit-open'));
  assert.ok(w.document.querySelectorAll('.orbit-link').length >= 9);
});

test('signed-in learner: /me populates the sidebar and dashboard data comes from the API', async () => {
  const { text, requests } = await boot({
    token: 'test-token',
    routes: {
      '/health': healthy,
      '/me': json(200, { user: { name: 'Test Learner', class_level: 'SHS 2', subjects: ['Core Mathematics'] } }),
      '/dashboard': json(200, { progress: { completedTopics: 3, minutesStudied: 45 }, tests: { tests: 1 }, journal: { journal_entries: 2 } }),
      '/journal': json(200, { entries: [] }),
      '/tests': json(200, { tests: [] }),
      '/learning-logs': json(200, { logs: [] })
    }
  });
  assert.equal(text('#connection'), 'Online · progress synced');
  assert.equal(text('#user-name'), 'Test Learner');
  assert.equal(text('#stat-topics'), '3');
  assert.equal(text('#stat-time'), '45 min');
  assert.ok(requests.filter(r => r.path !== '/health').every(r => r.auth === 'Bearer test-token'));
});

test('expired session is reported and the stale token is cleared', async () => {
  const { text, w } = await boot({
    token: 'expired-token',
    routes: { '/health': healthy, '/me': json(401, { error: 'Session expired. Sign in again.' }) }
  });
  assert.equal(text('#connection'), 'Session expired · sign in again');
  assert.equal(w.localStorage.getItem('gl_token'), null);
});

test('unreachable API is reported instead of staying on "Connecting…"', async () => {
  const { text } = await boot({ routes: { '/health': new TypeError('Failed to fetch') } });
  assert.equal(text('#connection'), 'API unreachable');
});

test('unexpected startup crash surfaces an error instead of "Connecting…"', async () => {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(e));
  const dom = new JSDOM(appHtml.replace('id="user-name"', 'id="renamed"'), { url: 'https://getlearny.test/app', runScripts: 'outside-only', virtualConsole });
  const w = dom.window;
  w.fetch = async () => healthy;
  // Force a synchronous startup failure and dispatch it the way a browser reports uncaught errors.
  w.document.querySelector('#today').remove();
  try { w.eval(appJs); } catch (e) { w.dispatchEvent(new w.ErrorEvent('error', { error: e, message: e.message })); }
  assert.equal(w.document.querySelector('#connection').textContent, 'App error · refresh the page');
});

test('no browser script uses querySelector helper $() as if it returned a list', () => {
  for (const file of ['app.js', 'focus.js', 'revision.js', 'auth.js', 'landing.js']) {
    const src = readFileSync(join(webDir, file), 'utf8');
    const bad = src.match(/(^|[^$\w])\$\('[^']*'\)\.(forEach|map|filter|some|every)\(/g);
    assert.equal(bad, null, `${file} calls $() (querySelector) like a list: ${bad}`);
  }
});
