/**
* AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
**/export const description = `Validation tests for 'if' statements'`;import { makeTestGroup } from '../../../../common/framework/test_group.js';
import { scalarTypeOf, Type } from '../../../util/conversion.js';
import { ShaderValidationTest } from '../shader_validation_test.js';

export const g = makeTestGroup(ShaderValidationTest);

const kTestTypes = [
'bool',
'i32',
'u32',
'f32',
'f16',
'vec2f',
'vec3h',
'vec4u',
'vec3b',
'mat2x3f',
'mat4x2h',
'abstract-int',
'abstract-float'];


g.test('condition_type').
desc(`Tests that an 'if' condition must be a bool type`).
params((u) => u.combine('type', kTestTypes)).
beforeAllSubcases((t) => {
  if (scalarTypeOf(Type[t.params.type]).kind === 'f16') {
    t.selectDeviceOrSkipTestCase('shader-f16');
  }
}).
fn((t) => {
  const type = Type[t.params.type];
  const code = `
${scalarTypeOf(type).kind === 'f16' ? 'enable f16;' : ''}

fn f() -> bool {
  if ${type.create(1).wgsl()} {
    return true;
  }
  return false;
}
`;

  const pass = t.params.type === 'bool';
  t.expectCompileResult(pass, code);
});

g.test('else_condition_type').
desc(`Tests that an 'else if' condition must be a bool type`).
params((u) => u.combine('type', kTestTypes)).
beforeAllSubcases((t) => {
  if (scalarTypeOf(Type[t.params.type]).kind === 'f16') {
    t.selectDeviceOrSkipTestCase('shader-f16');
  }
}).
fn((t) => {
  const type = Type[t.params.type];
  const code = `
${scalarTypeOf(type).kind === 'f16' ? 'enable f16;' : ''}

fn f(c : bool) -> bool {
  if (c) {
    return true;
  } else if (${type.create(1).wgsl()}) {
    return true;
  }
  return false;
}
`;

  const pass = t.params.type === 'bool';
  t.expectCompileResult(pass, code);
});