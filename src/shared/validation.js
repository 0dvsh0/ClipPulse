'use strict';

// Validation labels shared by the renderer signal provider and the main
// process. Integer codes match @smartspectra/node-sdk@3.5.0 ValidationCode.

const VALIDATION_LABELS = Object.freeze({
  0: 'TRACKING LOCKED',
  1: 'NO FACE DETECTED',
  2: 'MULTIPLE FACES',
  3: 'ALIGNMENT',
  4: 'SIGNAL BLOCKED',
  5: 'LIGHTING',
  6: 'LIGHTING',
  7: 'SIGNAL BLOCKED',
  10: 'CAMERA TUNING',
  11: 'FRAME RATE LOW',
  12: 'MOTION',
  13: 'ALIGNMENT',
  14: 'ALIGNMENT',
  15: 'ALIGNMENT',
  16: 'ALIGNMENT',
  17: 'ALIGNMENT',
});

function validationLabel(code) {
  return VALIDATION_LABELS[code] || `VALIDATION ${code}`;
}

function isValidationOk(code) {
  return code === 0;
}

function isValidationWarmup(code) {
  return code === 10;
}

module.exports = {
  VALIDATION_LABELS,
  validationLabel,
  isValidationOk,
  isValidationWarmup,
};
