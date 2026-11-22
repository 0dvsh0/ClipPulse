'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  VALIDATION_LABELS,
  validationLabel,
  isValidationOk,
  isValidationWarmup,
} = require('../src/shared/validation');

test('validationLabel maps standard smartspectra codes accurately', () => {
  assert.equal(validationLabel(0), 'TRACKING LOCKED');
  assert.equal(validationLabel(1), 'NO FACE DETECTED');
  assert.equal(validationLabel(2), 'MULTIPLE FACES');
  assert.equal(validationLabel(3), 'ALIGNMENT');
  assert.equal(validationLabel(4), 'SIGNAL BLOCKED');
  assert.equal(validationLabel(5), 'LIGHTING');
  assert.equal(validationLabel(6), 'LIGHTING');
  assert.equal(validationLabel(7), 'SIGNAL BLOCKED');
  assert.equal(validationLabel(10), 'CAMERA TUNING');
  assert.equal(validationLabel(11), 'FRAME RATE LOW');
  assert.equal(validationLabel(12), 'MOTION');
  assert.equal(validationLabel(13), 'ALIGNMENT');
  assert.equal(validationLabel(14), 'ALIGNMENT');
  assert.equal(validationLabel(15), 'ALIGNMENT');
  assert.equal(validationLabel(16), 'ALIGNMENT');
  assert.equal(validationLabel(17), 'ALIGNMENT');
});

test('validationLabel handles unknown and non-standard codes gracefully', () => {
  assert.equal(validationLabel(999), 'VALIDATION 999');
  assert.equal(validationLabel(-1), 'VALIDATION -1');
  assert.equal(validationLabel('custom'), 'VALIDATION custom');
});

test('isValidationOk identifies tracking lock state exclusively', () => {
  assert.equal(isValidationOk(0), true);
  assert.equal(isValidationOk(1), false);
  assert.equal(isValidationOk(10), false);
  assert.equal(isValidationOk(null), false);
  assert.equal(isValidationOk(undefined), false);
});

test('isValidationWarmup identifies camera tuning state exclusively', () => {
  assert.equal(isValidationWarmup(10), true);
  assert.equal(isValidationWarmup(0), false);
  assert.equal(isValidationWarmup(1), false);
  assert.equal(isValidationWarmup(null), false);
});
