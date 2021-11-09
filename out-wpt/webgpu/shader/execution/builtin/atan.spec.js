/**
 * AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
 **/ export const description = `
Execution Tests for the 'atan' builtin function
`;
import { makeTestGroup } from '../../../../common/framework/test_group.js';
import { GPUTest } from '../../../gpu_test.js';
import { f32, f32Bits, TypeF32 } from '../../../util/conversion.js';

import { kBit, run, ulpThreshold } from './builtin.js';

export const g = makeTestGroup(GPUTest);

g.test('float_builtin_functions,atan')
  .uniqueId('b13828d6243d13dd')
  .specURL('https://www.w3.org/TR/2021/WD-WGSL-20210929/#float-builtin-functions')
  .desc(
    `
atan:
T is f32 or vecN<f32> atan(e: T ) -> T Returns the arc tangent of e. Component-wise when T is a vector. (GLSLstd450Atan)
`
  )
  .params(u =>
    u
      .combine('storageClass', ['uniform', 'storage_r', 'storage_rw'])
      .combine('vectorize', [undefined, 2, 3, 4])
  )
  .fn(async t => {
    // TODO(https://github.com/gpuweb/cts/issues/792): Decide what the ground-truth is for these tests.
    const truthFunc = x => {
      return Math.atan(x);
    };

    // Well defined/border cases
    const manual = [
      { input: f32Bits(kBit.f32.infinity.negative), expected: f32(-Math.PI / 2) },
      { input: f32(-Math.sqrt(3)), expected: f32(-Math.PI / 3) },
      { input: f32(-1), expected: f32(-Math.PI / 4) },
      { input: f32(-Math.sqrt(3) / 3), expected: f32(-Math.PI / 6) },
      { input: f32(0), expected: f32(0) },
      { input: f32(Math.sqrt(3) / 3), expected: f32(Math.PI / 6) },
      { input: f32(1), expected: f32(Math.PI / 4) },
      { input: f32(Math.sqrt(3)), expected: f32(Math.PI / 3) },
      { input: f32Bits(kBit.f32.infinity.positive), expected: f32(Math.PI / 2) },
    ];

    // Spread of cases over wide domain
    const automatic = new Array(1000);
    const increment = (kBit.f32.positive.max - kBit.f32.negative.min) / automatic.length;
    for (let i = 0; i < automatic.length; i++) {
      const x = kBit.f32.negative.min + increment * i;
      automatic[i] = { input: f32(x), expected: f32(truthFunc(x)) };
    }

    const cfg = t.params;
    cfg.cmpFloats = ulpThreshold(4096);
    run(t, 'atan', [TypeF32], TypeF32, cfg, manual.concat(automatic));
  });
