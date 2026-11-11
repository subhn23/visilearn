import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isStepComplete, resumeIndex, stepStatus } from '../src/app/model/stepFlow.ts';

test('resumeIndex opens the first unfinished step, or the first step when all are done', () => {
  assert.equal(resumeIndex([], 4), 0);
  assert.equal(resumeIndex([0, 1], 4), 2);
  assert.equal(resumeIndex([0, 2], 4), 1);
  assert.equal(resumeIndex([0, 1, 2, 3], 4), 0);
  assert.equal(resumeIndex([5, 6], 2), 0);
});

test('a step is complete only when actions finished, asks answered and goals met', () => {
  const base = { actionsDone: true, asks: 2, correct: 2, goals: [true, true] };
  assert.equal(isStepComplete(base), true);
  assert.equal(isStepComplete({ ...base, actionsDone: false }), false);
  assert.equal(isStepComplete({ ...base, correct: 1 }), false);
  assert.equal(isStepComplete({ ...base, goals: [true, false] }), false);
  assert.equal(isStepComplete({ actionsDone: true, asks: 0, correct: 0, goals: [] }), true);
});

test('stepStatus explains what is left to do', () => {
  assert.deepEqual(stepStatus({ actionsDone: false, asks: 0, correct: 0, goals: [] }), { tone: 'idle', text: 'Watch…' });
  assert.deepEqual(stepStatus({ actionsDone: true, asks: 1, correct: 0, goals: [] }), { tone: 'todo', text: 'Answer the question to continue.' });
  assert.deepEqual(stepStatus({ actionsDone: true, asks: 0, correct: 0, goals: [true, false, false] }), { tone: 'todo', text: '1 of 3 goals met.' });
  assert.deepEqual(stepStatus({ actionsDone: true, asks: 0, correct: 0, goals: [true] }), { tone: 'done', text: 'Challenge complete!' });
  assert.deepEqual(stepStatus({ actionsDone: true, asks: 0, correct: 0, goals: [] }), { tone: 'done', text: 'Step complete.' });
});
