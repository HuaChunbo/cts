/**
 * AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
 **/ const builtin = 'log2';
export const description = `
Validation tests for the ${builtin}() builtin.
`;
import { makeTestGroup } from '../../../../../../common/framework/test_group.js';
import {
  TypeF16,
  TypeF32,
  elementType,
  kAllFloatScalarsAndVectors,
  kAllIntegerScalarsAndVectors,
} from '../../../../../util/conversion.js';
import { ShaderValidationTest } from '../../../shader_validation_test.js';

import {
  fullRangeForType,
  kConstantAndOverrideStages,
  stageSupportsType,
  validateConstOrOverrideBuiltinEval,
} from './const_override_validation.js';

export const g = makeTestGroup(ShaderValidationTest);

g.test('values')
  .desc(
    `
Validates that constant evaluation and override evaluation of ${builtin}() inputs rejects invalid values
`
  )
  .params(u =>
    u
      .combine('stage', kConstantAndOverrideStages)
      .combine('type', kAllFloatScalarsAndVectors)
      .filter(u => stageSupportsType(u.stage, u.type))
      .expand('value', u => fullRangeForType(u.type))
  )
  .beforeAllSubcases(t => {
    if (elementType(t.params.type) === TypeF16) {
      t.selectDeviceOrSkipTestCase('shader-f16');
    }
  })
  .fn(t => {
    const expectedResult = t.params.value > 0;
    validateConstOrOverrideBuiltinEval(
      t,
      builtin,
      expectedResult,
      t.params.value,
      t.params.type,
      t.params.stage
    );
  });

g.test('integer_argument')
  .desc(
    `
Validates that scalar and vector integer arguments are rejected by ${builtin}()
`
  )
  .params(u => u.combine('type', [TypeF32, ...kAllIntegerScalarsAndVectors]))
  .fn(t => {
    validateConstOrOverrideBuiltinEval(
      t,
      builtin,
      /* expectedResult */ t.params.type === TypeF32,
      /* value */ 1,
      t.params.type,
      'constant'
    );
  });
