import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStudyDays, computeStreak } from '../src/streak.js';

test('normalizes date strings and PostgreSQL Date objects, discarding invalid values', () => {
  assert.deepEqual(normalizeStudyDays([
    { study_day: '2026-10-29' },
    { study_day: new Date('2026-10-28T00:00:00.000Z') },
    { study_day: 'not-a-date' },
    { study_day: null }
  ]), ['2026-10-29', '2026-10-28']);
});

test('counts current streak through today or yesterday', () => {
  assert.deepEqual(
    computeStreak(['2026-10-29', '2026-10-28', '2026-10-26'], new Date('2026-10-29T12:00:00Z')),
    { current: 2, longest: 2, activeDays: 3, lastStudyDay: '2026-10-29' }
  );
  assert.equal(computeStreak(['2026-10-28'], new Date('2026-10-29T12:00:00Z')).current, 1);
});

test('resets current streak after an inactive day and finds longest historical streak', () => {
  const result = computeStreak(
    ['2026-10-25', '2026-10-23', '2026-10-22', '2026-10-21'],
    new Date('2026-10-29T12:00:00Z')
  );
  assert.equal(result.current, 0);
  assert.equal(result.longest, 3);
});
