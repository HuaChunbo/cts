/**
* AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
**/export const description = `
Atomically read, max and store value.

 * Load the original value pointed to by atomic_ptr.
 * Obtains a new value by taking the max with the value v.
 * Store the new value using atomic_ptr.

Returns the original value stored in the atomic object.
`;import { makeTestGroup } from '../../../../../../common/framework/test_group.js';
import { GPUTest } from '../../../../../gpu_test.js';

export const g = makeTestGroup(GPUTest);

g.test('max').
specURL('https://www.w3.org/TR/WGSL/#atomic-rmw').
desc(
`
AS is storage or workgroup
T is i32 or u32

fn atomicMax(atomic_ptr: ptr<AS, atomic<T>, read_write>, v: T) -> T
`).

params((u) =>
u.combine('SC', ['storage', 'uniform']).combine('T', ['i32', 'u32'])).

unimplemented();
//# sourceMappingURL=atomicMax.spec.js.map