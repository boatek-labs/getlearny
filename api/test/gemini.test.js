import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWithGemini } from '../src/app.js';

const originalFetch = globalThis.fetch;
const originalEnv = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  GEMINI_FALLBACK_MODELS: process.env.GEMINI_FALLBACK_MODELS
};

function restoreEnvironment() {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('Gemini retries a transient 503 on a fallback model', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-3.6-flash,gemini-3.5-flash-lite';
  const requests = [];
  const failures = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), body: JSON.parse(options.body) });
    if (requests.length === 1) {
      return new Response(JSON.stringify({ error: { message: 'temporarily busy' } }), {
        status: 503,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: '{"questions":[]}' }] } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await generateWithGemini({
      system: 'test system',
      user: 'test prompt',
      json: true,
      timeoutMs: 12000,
      validateResponse: text => text.includes('"questions"'),
      onFailure: failure => failures.push(failure)
    });
    assert.equal(result, '{"questions":[]}');
    assert.equal(requests.length, 2);
    assert.match(requests[0].url, /gemini-3\.8-flash:generateContent/);
    assert.match(requests[1].url, /gemini-3\.6-flash:generateContent/);
    assert.equal(requests[1].body.generationConfig.thinkingConfig.thinkingLevel, 'low');
    assert.equal('temperature' in requests[1].body.generationConfig, false);
    assert.deepEqual(failures, []);
  } finally {
    restoreEnvironment();
  }
});

test('Gemini retries when a response fails the requested output validation', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_MODEL = 'gemini-3.8-flash';
  process.env.GEMINI_FALLBACK_MODELS = 'gemini-3.6-flash';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const text = calls === 1 ? '{"questions":[]}' : '{"questions":[{"question":"valid"}]}';
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await generateWithGemini({
      system: 'test system',
      user: 'test prompt',
      json: true,
      timeoutMs: 12000,
      validateResponse: text => text.includes('"question":"valid"')
    });
    assert.equal(result, '{"questions":[{"question":"valid"}]}');
    assert.equal(calls, 2);
  } finally {
    restoreEnvironment();
  }
});

test('Gemini reports a missing key without making a network request', async () => {
  delete process.env.GEMINI_API_KEY;
  let calls = 0;
  const failures = [];
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('fetch should not run without a key');
  };

  try {
    const result = await generateWithGemini({
      system: 'test system',
      user: 'test prompt',
      onFailure: failure => failures.push(failure)
    });
    assert.equal(result, null);
    assert.equal(calls, 0);
    assert.equal(failures[0]?.kind, 'missing_key');
  } finally {
    restoreEnvironment();
  }
});
