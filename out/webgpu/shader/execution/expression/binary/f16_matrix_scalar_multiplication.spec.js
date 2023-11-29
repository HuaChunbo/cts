/**
* AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
**/export const description = `
Execution Tests for matrix-scalar and scalar-matrix f16 multiplication expression
`;import { makeTestGroup } from '../../../../../common/framework/test_group.js';
import { GPUTest } from '../../../../gpu_test.js';
import { TypeF16, TypeMat } from '../../../../util/conversion.js';
import { allInputSources, run } from '../expression.js';

import { binary, compoundBinary } from './binary.js';
import { d } from './f16_matrix_scalar_multiplication.cache.js';

export const g = makeTestGroup(GPUTest);

g.test('matrix_scalar').
specURL('https://www.w3.org/TR/WGSL/#floating-point-evaluation').
desc(
  `
Expression: x * y, where x is a matrix and y is a scalar
Accuracy: Correctly rounded
`
).
params((u) =>
u.
combine('inputSource', allInputSources).
combine('cols', [2, 3, 4]).
combine('rows', [2, 3, 4])
).
beforeAllSubcases((t) => {
  t.selectDeviceOrSkipTestCase({ requiredFeatures: ['shader-f16'] });
}).
fn(async (t) => {
  const cols = t.params.cols;
  const rows = t.params.rows;
  const cases = await d.get(
    t.params.inputSource === 'const' ?
    `mat${cols}x${rows}_scalar_const` :
    `mat${cols}x${rows}_scalar_non_const`
  );
  await run(
    t,
    binary('*'),
    [TypeMat(cols, rows, TypeF16), TypeF16],
    TypeMat(cols, rows, TypeF16),
    t.params,
    cases
  );
});

g.test('matrix_scalar_compound').
specURL('https://www.w3.org/TR/WGSL/#floating-point-evaluation').
desc(
  `
Expression: x *= y, where x is a matrix and y is a scalar
Accuracy: Correctly rounded
`
).
params((u) =>
u.
combine('inputSource', allInputSources).
combine('cols', [2, 3, 4]).
combine('rows', [2, 3, 4])
).
beforeAllSubcases((t) => {
  t.selectDeviceOrSkipTestCase({ requiredFeatures: ['shader-f16'] });
}).
fn(async (t) => {
  const cols = t.params.cols;
  const rows = t.params.rows;
  const cases = await d.get(
    t.params.inputSource === 'const' ?
    `mat${cols}x${rows}_scalar_const` :
    `mat${cols}x${rows}_scalar_non_const`
  );
  await run(
    t,
    compoundBinary('*='),
    [TypeMat(cols, rows, TypeF16), TypeF16],
    TypeMat(cols, rows, TypeF16),
    t.params,
    cases
  );
});

g.test('scalar_matrix').
specURL('https://www.w3.org/TR/WGSL/#floating-point-evaluation').
desc(
  `
Expression: x * y, where x is a scalar and y is a matrix
Accuracy: Correctly rounded
`
).
params((u) =>
u.
combine('inputSource', allInputSources).
combine('cols', [2, 3, 4]).
combine('rows', [2, 3, 4])
).
beforeAllSubcases((t) => {
  t.selectDeviceOrSkipTestCase({ requiredFeatures: ['shader-f16'] });
}).
fn(async (t) => {
  const cols = t.params.cols;
  const rows = t.params.rows;
  const cases = await d.get(
    t.params.inputSource === 'const' ?
    `scalar_mat${cols}x${rows}_const` :
    `scalar_mat${cols}x${rows}_non_const`
  );
  await run(
    t,
    binary('*'),
    [TypeF16, TypeMat(cols, rows, TypeF16)],
    TypeMat(cols, rows, TypeF16),
    t.params,
    cases
  );
});
//# sourceMappingURL=f16_matrix_scalar_multiplication.spec.js.map