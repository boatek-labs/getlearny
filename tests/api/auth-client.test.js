import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('both date-of-birth fields use real digit classes for masking', async () => {
  const [auth, consent] = await Promise.all([
    read('../../web/auth.js'),
    read('../../web/consent.js')
  ]);

  for (const [name, source] of [['landing signup', auth], ['account consent gate', consent]]) {
    assert.ok(source.includes('match(/\\d/g)'), name + ' counts digits correctly');
    assert.ok(source.includes('replace(/\\D/g'), name + ' strips separators and non-digits');
    assert.ok(!source.includes('match(/\\\\d/g)'), name + ' must not use a double-escaped digit class');
    assert.ok(!source.includes('replace(/\\\\D/g'), name + ' must not use a double-escaped non-digit class');
  }
});

test('age and terms declaration responses preserve the provisional Google session', async () => {
  const app = await read('../../web/app.js');

  assert.ok(app.includes("error.code=typeof data.code==='string'?data.code:''"));
  assert.ok(app.includes("error.status===403&&['AGE_DECLARATION_REQUIRED','TERMS_REACCEPT_REQUIRED'].includes(error.code)"));
});

test('legacy direct registration cannot bypass email OTP verification', async () => {
  const app = await read('../../api/src/app.js');

  assert.ok(app.includes("app.post('/api/v1/auth/register',emailOtpLimiter,(_req,res)=>res.status(410)"));
  assert.ok(app.includes('/auth/register/request-otp'));
  assert.ok(app.includes('/auth/register/verify-otp'));
});

test('updated auth scripts use fresh cache keys', async () => {
  const [index, app] = await Promise.all([
    read('../../web/index.html'),
    read('../../web/app.html')
  ]);

  assert.ok(index.includes('/auth.js?v=20261126-auth-review1'));
  assert.ok(app.includes('/app.js?v=20261126-auth-gate1'));
  assert.ok(app.includes('/consent.js?v=20261126-auth-gate1'));
});
