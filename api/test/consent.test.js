import test from 'node:test';
import assert from 'node:assert/strict';
import { ageOn, validateSignupConsent, accountGate } from '../src/consent.js';

test('ageOn calculates age before and after birthday', () => {
  const now = new Date('2026-10-29T12:00:00Z');
  assert.equal(ageOn('2008-10-29', now), 18);
  assert.equal(ageOn('2008-10-30', now), 17);
  assert.ok(Number.isNaN(ageOn('2026-02-31', now)));
});

test('signup requires a valid date of birth and terms acceptance', () => {
  assert.equal(validateSignupConsent({date_of_birth:'',accept_terms:true}).ok, false);
  assert.equal(validateSignupConsent({date_of_birth:'2000-01-01',accept_terms:false}).ok, false);
  assert.equal(validateSignupConsent({date_of_birth:'2018-01-01',accept_terms:true}).ok, false);
});

test('under-18 signup requires a distinct guardian email', () => {
  const base = {date_of_birth:'2010-01-01',accept_terms:true};
  assert.equal(validateSignupConsent({...base,guardian_email:'learner@example.com'},'learner@example.com').ok, false);
  const valid = validateSignupConsent({...base,guardian_email:'guardian@example.com'},'learner@example.com');
  assert.equal(valid.ok, true);
  assert.equal(valid.minor, true);
});

test('adult signup passes and guardian account states are gated', () => {
  assert.equal(validateSignupConsent({date_of_birth:'2000-01-01',accept_terms:true},'adult@example.com').ok, true);
  assert.equal(accountGate('pending_guardian').code, 'GUARDIAN_APPROVAL_PENDING');
  assert.equal(accountGate('active'), null);
});
