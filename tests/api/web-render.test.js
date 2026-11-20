import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile(new URL('../../web/app.js', import.meta.url), 'utf8');

function extractBetween(startMarker, endMarker) {
  const start = appSource.indexOf(startMarker);
  const end = appSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, 'start marker must exist in web/app.js');
  assert.notEqual(end, -1, 'end marker must exist in web/app.js');
  return appSource.slice(start, end);
}

const subjectSource = extractBetween(
  'function subjectIdentity(value){',
  '\nfunction subjectCard'
);
const markdownSource = extractBetween(
  'function markdownLite(input){',
  '\nasync function generateLesson'
);

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

test('recovers all seven subjects from a concatenated learner profile', () => {
  const state = {
    user: {
      subjects: ['Chemistryenglishbiologycore mathadd mathsocial studiescomputer science']
    }
  };
  const getLearnerSubjects = new Function('state', subjectSource + '\nreturn getLearnerSubjects;')(state);
  assert.deepEqual(getLearnerSubjects(), [
    'Chemistry',
    'English',
    'Biology',
    'Core Math',
    'Add Math',
    'Social Studies',
    'Computer Science'
  ]);
});

test('normalizes subject aliases and removes duplicates', () => {
  const state = {
    user: {
      subjects: ['English', 'English Language', 'Core Math', 'Core Mathematics', 'Chemistry']
    }
  };
  const getLearnerSubjects = new Function('state', subjectSource + '\nreturn getLearnerSubjects;')(state);
  assert.deepEqual(getLearnerSubjects(), ['English', 'Core Math', 'Chemistry']);
});

test('renders headings, ordered lists, equations and fenced code blocks', () => {
  const markdownLite = new Function('esc', markdownSource + '\nreturn markdownLite;')(escapeHtml);
  const fence = String.fromCharCode(96).repeat(3);
  const html = markdownLite([
    '### Worked Example',
    '1. **Make y the subject**',
    '2. Substitute: $x^2 + (x+3)^2 = 29$',
    '',
    fence + 'js',
    'const x = 2;',
    fence
  ].join('\n'));

  assert.match(html, /<h4>Worked Example<\/h4>/);
  assert.match(html, /<ol><li><strong>Make y the subject<\/strong><\/li><li>/);
  assert.match(html, /class="tutor-math-inline"/);
  assert.match(html, /class="tutor-code"/);
});

test('escapes model-provided HTML instead of inserting executable markup', () => {
  const markdownLite = new Function('esc', markdownSource + '\nreturn markdownLite;')(escapeHtml);
  const html = markdownLite('<img src=x onerror=alert(1)>');
  assert.equal(html, '<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  assert.doesNotMatch(html, /<img/);
});
