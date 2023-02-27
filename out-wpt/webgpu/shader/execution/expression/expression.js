/**
 * AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
 **/ import { globalTestConfig } from '../../../../common/framework/test_config.js';
import { assert, objectEquals, unreachable } from '../../../../common/util/util.js';
import { compare, anyOf } from '../../../util/compare.js';
import {
  ScalarType,
  Scalar,
  TypeVec,
  TypeU32,
  Vector,
  VectorType,
  f32,
  u32,
  i32,
  Matrix,
  MatrixType,
} from '../../../util/conversion.js';
import { F32Interval } from '../../../util/f32_interval.js';
import {
  cartesianProduct,
  map2DArray,
  quantizeToF32,
  quantizeToI32,
  quantizeToU32,
} from '../../../util/math.js';

/** Is this expectation actually a Comparator */
function isComparator(e) {
  return !(
    e instanceof F32Interval ||
    e instanceof Scalar ||
    e instanceof Vector ||
    e instanceof Matrix ||
    e instanceof Array
  );
}

/** Helper for converting Values to Comparators */
export function toComparator(input) {
  if (!isComparator(input)) {
    return got => compare(got, input);
  }
  return input;
}

/** Case is a single expression test case. */

// Read-write storage buffer

/** All possible input sources */
export const allInputSources = ['const', 'uniform', 'storage_r', 'storage_rw'];

/** Configuration for running a expression test */

// Helper for returning the stride for a given Type
function valueStride(ty) {
  if (ty instanceof MatrixType) {
    switch (ty.cols) {
      case 2:
        switch (ty.rows) {
          case 2:
            return 16;
          case 3:
            return 32;
          case 4:
            return 32;
        }

        break;
      case 3:
        switch (ty.rows) {
          case 2:
            return 32;
          case 3:
            return 64;
          case 4:
            return 64;
        }

        break;
      case 4:
        switch (ty.rows) {
          case 2:
            return 32;
          case 3:
            return 64;
          case 4:
            return 64;
        }

        break;
    }

    unreachable(
      `Attempted to get stride length for a matrix with dimensions (${ty.cols}x${ty.rows}), which isn't currently handled`
    );
  }

  // Handles scalars and vectors
  return 16;
}

// Helper for summing up all of the stride values for an array of Types
function valueStrides(tys) {
  return tys.map(valueStride).reduce((sum, c) => sum + c);
}

// Helper for returning the WGSL storage type for the given Type.
function storageType(ty) {
  if (ty instanceof ScalarType) {
    if (ty.kind === 'bool') {
      return TypeU32;
    }
  }
  if (ty instanceof VectorType) {
    return TypeVec(ty.width, storageType(ty.elementType));
  }
  return ty;
}

// Helper for converting a value of the type 'ty' from the storage type.
function fromStorage(ty, expr) {
  if (ty instanceof ScalarType) {
    if (ty.kind === 'bool') {
      return `${expr} != 0u`;
    }
  }
  if (ty instanceof VectorType) {
    if (ty.elementType.kind === 'bool') {
      return `${expr} != vec${ty.width}<u32>(0u)`;
    }
  }
  return expr;
}

// Helper for converting a value of the type 'ty' to the storage type.
function toStorage(ty, expr) {
  if (ty instanceof ScalarType) {
    if (ty.kind === 'bool') {
      return `select(0u, 1u, ${expr})`;
    }
  }
  if (ty instanceof VectorType) {
    if (ty.elementType.kind === 'bool') {
      return `select(vec${ty.width}<u32>(0u), vec${ty.width}<u32>(1u), ${expr})`;
    }
  }
  return expr;
}

// ExpressionBuilder returns the WGSL used to test an expression.

/**
 * Searches for an entry with the given key, adding and returning the result of calling
 * @p create if the entry was not found.
 * @param map the cache map
 * @param key the entry's key
 * @param create the function used to construct a value, if not found in the cache
 * @returns the value, either fetched from the cache, or newly built.
 */
function getOrCreate(map, key, create) {
  const existing = map.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const value = create();
  map.set(key, value);
  return value;
}
/**
 * Runs the list of expression tests, possibly splitting the tests into multiple
 * dispatches to keep the input data within the buffer binding limits.
 * run() will pack the scalar test cases into smaller set of vectorized tests
 * if `cfg.vectorize` is defined.
 * @param t the GPUTest
 * @param expressionBuilder the expression builder function
 * @param parameterTypes the list of expression parameter types
 * @param returnType the return type for the expression overload
 * @param cfg test configuration values
 * @param cases list of test cases
 */
export async function run(
  t,
  expressionBuilder,
  parameterTypes,
  returnType,
  cfg = { inputSource: 'storage_r' },
  cases
) {
  // If the 'vectorize' config option was provided, pack the cases into vectors.
  if (cfg.vectorize !== undefined) {
    const packed = packScalarsToVector(parameterTypes, returnType, cases, cfg.vectorize);
    cases = packed.cases;
    parameterTypes = packed.parameterTypes;
    returnType = packed.returnType;
  }

  // The size of the input buffer may exceed the maximum buffer binding size,
  // so chunk the tests up into batches that fit into the limits. We also split
  // the cases into smaller batches to help with shader compilation performance.
  const casesPerBatch = (function () {
    switch (cfg.inputSource) {
      case 'const':
        // Some drivers are slow to optimize shaders with many constant values,
        // or statements. 32 is an empirically picked number of cases that works
        // well for most drivers.
        return 32;
      case 'uniform':
        // Some drivers are slow to build pipelines with large uniform buffers.
        // 2k appears to be a sweet-spot when benchmarking.
        return Math.floor(
          Math.min(1024 * 2, t.device.limits.maxUniformBufferBindingSize) /
            valueStrides(parameterTypes)
        );

      case 'storage_r':
      case 'storage_rw':
        return Math.floor(
          t.device.limits.maxStorageBufferBindingSize / valueStrides(parameterTypes)
        );
    }
  })();

  // A cache to hold built shader pipelines.
  const pipelineCache = new Map();

  // Submit all the cases in batches, each in a separate error scope.
  const checkResults = [];
  for (let i = 0; i < cases.length; i += casesPerBatch) {
    const batchCases = cases.slice(i, Math.min(i + casesPerBatch, cases.length));

    t.device.pushErrorScope('validation');

    const checkBatch = submitBatch(
      t,
      expressionBuilder,
      parameterTypes,
      returnType,
      batchCases,
      cfg.inputSource,
      pipelineCache
    );

    checkResults.push(
      // Check GPU validation (shader compilation, pipeline creation, etc) before checking the batch results.
      t.device.popErrorScope().then(error => {
        if (error === null) {
          checkBatch();
        } else {
          t.fail(error.message);
        }
      })
    );
  }

  // Check the results
  await Promise.all(checkResults);
}

/**
 * Submits the list of expression tests. The input data must fit within the
 * buffer binding limits of the given inputSource.
 * @param t the GPUTest
 * @param expressionBuilder the expression builder function
 * @param parameterTypes the list of expression parameter types
 * @param returnType the return type for the expression overload
 * @param cases list of test cases that fit within the binding limits of the device
 * @param inputSource the source of the input values
 * @param pipelineCache the cache of compute pipelines, shared between batches
 * @returns a function that checks the results are as expected
 */
function submitBatch(
  t,
  expressionBuilder,
  parameterTypes,
  returnType,
  cases,
  inputSource,
  pipelineCache
) {
  // Construct a buffer to hold the results of the expression tests
  const outputBufferSize = cases.length * valueStride(returnType);
  const outputBuffer = t.device.createBuffer({
    size: outputBufferSize,
    usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
  });

  const [pipeline, group] = buildPipeline(
    t,
    expressionBuilder,
    parameterTypes,
    returnType,
    cases,
    inputSource,
    outputBuffer,
    pipelineCache
  );

  const encoder = t.device.createCommandEncoder();
  const pass = encoder.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, group);
  pass.dispatchWorkgroups(1);
  pass.end();

  // Heartbeat to ensure CTS runners know we're alive.
  globalTestConfig.testHeartbeatCallback();

  t.queue.submit([encoder.finish()]);

  // Return a function that can check the results of the shader
  return () => {
    const checkExpectation = outputData => {
      // Read the outputs from the output buffer
      const outputs = new Array(cases.length);
      for (let i = 0; i < cases.length; i++) {
        outputs[i] = returnType.read(outputData, i * valueStride(returnType));
      }

      // The list of expectation failures
      const errs = [];

      // For each case...
      for (let caseIdx = 0; caseIdx < cases.length; caseIdx++) {
        const c = cases[caseIdx];
        const got = outputs[caseIdx];
        const cmp = toComparator(c.expected)(got);
        if (!cmp.matched) {
          errs.push(`(${c.input instanceof Array ? c.input.join(', ') : c.input})
    returned: ${cmp.got}
    expected: ${cmp.expected}`);
        }
      }

      return errs.length > 0 ? new Error(errs.join('\n\n')) : undefined;
    };

    // Heartbeat to ensure CTS runners know we're alive.
    globalTestConfig.testHeartbeatCallback();

    t.expectGPUBufferValuesPassCheck(outputBuffer, checkExpectation, {
      type: Uint8Array,
      typedLength: outputBufferSize,
    });
  };
}

/**
 * @param v either an array of T or a single element of type T
 * @param i the value index to
 * @returns the i'th value of v, if v is an array, otherwise v (i must be 0)
 */
function ith(v, i) {
  if (v instanceof Array) {
    assert(i < v.length);
    return v[i];
  }
  assert(i === 0);
  return v;
}

/**
 * Constructs and returns a GPUComputePipeline and GPUBindGroup for running a
 * batch of test cases. If a pre-created pipeline can be found in
 * @p pipelineCache, then this may be returned instead of creating a new
 * pipeline.
 * @param t the GPUTest
 * @param expressionBuilder the expression builder function
 * @param parameterTypes the list of expression parameter types
 * @param returnType the return type for the expression overload
 * @param cases list of test cases that fit within the binding limits of the device
 * @param inputSource the source of the input values
 * @param outputBuffer the buffer that will hold the output values of the tests
 * @param pipelineCache the cache of compute pipelines, shared between batches
 */
function buildPipeline(
  t,
  expressionBuilder,
  parameterTypes,
  returnType,
  cases,
  inputSource,
  outputBuffer,
  pipelineCache
) {
  // wgsl declaration of output buffer and binding
  const wgslValueStride = valueStride(returnType);
  const wgslStorageType = storageType(returnType);
  const wgslOutputs = `
struct Output {
  @size(${wgslValueStride}) value : ${wgslStorageType}
};
@group(0) @binding(0) var<storage, read_write> outputs : array<Output, ${cases.length}>;
`;

  cases.forEach(c => {
    const inputTypes = c.input instanceof Array ? c.input.map(i => i.type) : [c.input.type];
    if (!objectEquals(inputTypes, parameterTypes)) {
      const input_str = `[${inputTypes.join(',')}]`;
      const param_str = `[${parameterTypes.join(',')}]`;
      throw new Error(
        `case input types ${input_str} do not match provided runner parameter types ${param_str}`
      );
    }
  });

  switch (inputSource) {
    case 'const': {
      //////////////////////////////////////////////////////////////////////////
      // Input values are constant values in the WGSL shader
      //////////////////////////////////////////////////////////////////////////
      const wgslValues = cases.map(c => {
        const args = parameterTypes.map((_, i) => `(${ith(c.input, i).wgsl()})`);
        return `${toStorage(returnType, expressionBuilder(args))}`;
      });

      const wgslBody = globalTestConfig.unrollConstEvalLoops
        ? wgslValues.map((_, i) => `outputs[${i}].value = values[${i}];`).join('\n  ')
        : `for (var i = 0u; i < ${cases.length}; i++) {
    outputs[i].value = values[i];
  }`;

      // the full WGSL shader source
      const source = `
${wgslOutputs}

const values = array<${wgslStorageType}, ${cases.length}>(
  ${wgslValues.join(',\n  ')}
);

@compute @workgroup_size(1)
fn main() {
  ${wgslBody}
}
`;

      // build the shader module
      const module = t.device.createShaderModule({ code: source });

      // build the pipeline
      const pipeline = t.device.createComputePipeline({
        layout: 'auto',
        compute: { module, entryPoint: 'main' },
      });

      // build the bind group
      const group = t.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: outputBuffer } }],
      });

      return [pipeline, group];
    }

    case 'uniform':
    case 'storage_r':
    case 'storage_rw': {
      //////////////////////////////////////////////////////////////////////////
      // Input values come from a uniform or storage buffer
      //////////////////////////////////////////////////////////////////////////

      // returns the WGSL expression to load the ith parameter of the given type from the input buffer
      const paramExpr = (ty, i) => fromStorage(ty, `inputs[i].param${i}`);

      // resolves to the expression that calls the builtin
      const expr = toStorage(returnType, expressionBuilder(parameterTypes.map(paramExpr)));

      // input binding var<...> declaration
      const wgslInputVar = (function () {
        switch (inputSource) {
          case 'storage_r':
            return 'var<storage, read>';
          case 'storage_rw':
            return 'var<storage, read_write>';
          case 'uniform':
            return 'var<uniform>';
        }
      })();

      // the full WGSL shader source
      const source = `
struct Input {
${parameterTypes
  .map((ty, i) => `  @size(${valueStride(ty)}) param${i} : ${storageType(ty)},`)
  .join('\n')}
};

${wgslOutputs}

@group(0) @binding(1)
${wgslInputVar} inputs : array<Input, ${cases.length}>;

@compute @workgroup_size(1)
fn main() {
  for(var i = 0; i < ${cases.length}; i++) {
    outputs[i].value = ${expr};
  }
}
`;

      // size in bytes of the input buffer
      const inputSize = cases.length * valueStrides(parameterTypes);

      // Holds all the parameter values for all cases
      const inputData = new Uint8Array(inputSize);

      // Pack all the input parameter values into the inputData buffer
      {
        const caseStride = valueStrides(parameterTypes);
        for (let caseIdx = 0; caseIdx < cases.length; caseIdx++) {
          const caseBase = caseIdx * caseStride;
          let offset = caseBase;
          for (let paramIdx = 0; paramIdx < parameterTypes.length; paramIdx++) {
            const params = cases[caseIdx].input;
            if (params instanceof Array) {
              params[paramIdx].copyTo(inputData, offset);
            } else {
              params.copyTo(inputData, offset);
            }
            offset += valueStride(parameterTypes[paramIdx]);
          }
        }
      }

      // build the compute pipeline, if the shader hasn't been compiled already.
      const pipeline = getOrCreate(pipelineCache, source, () => {
        // build the shader module
        const module = t.device.createShaderModule({ code: source });

        // build the pipeline
        return t.device.createComputePipeline({
          layout: 'auto',
          compute: { module, entryPoint: 'main' },
        });
      });

      // build the input buffer
      const inputBuffer = t.makeBufferWithContents(
        inputData,
        GPUBufferUsage.COPY_SRC |
          (inputSource === 'uniform' ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE)
      );

      // build the bind group
      const group = t.device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: outputBuffer } },
          { binding: 1, resource: { buffer: inputBuffer } },
        ],
      });

      return [pipeline, group];
    }
  }
}

/**
 * Packs a list of scalar test cases into a smaller list of vector cases.
 * Requires that all parameters of the expression overload are of a scalar type,
 * and the return type of the expression overload is also a scalar type.
 * If `cases.length` is not a multiple of `vectorWidth`, then the last scalar
 * test case value is repeated to fill the vector value.
 */
function packScalarsToVector(parameterTypes, returnType, cases, vectorWidth) {
  // Validate that the parameters and return type are all vectorizable
  for (let i = 0; i < parameterTypes.length; i++) {
    const ty = parameterTypes[i];
    if (!(ty instanceof ScalarType)) {
      throw new Error(
        `packScalarsToVector() can only be used on scalar parameter types, but the ${i}'th parameter type is a ${ty}'`
      );
    }
  }
  if (!(returnType instanceof ScalarType)) {
    throw new Error(
      `packScalarsToVector() can only be used with a scalar return type, but the return type is a ${returnType}'`
    );
  }

  const packedCases = [];
  const packedParameterTypes = parameterTypes.map(p => TypeVec(vectorWidth, p));
  const packedReturnType = new VectorType(vectorWidth, returnType);

  const clampCaseIdx = idx => Math.min(idx, cases.length - 1);

  let caseIdx = 0;
  while (caseIdx < cases.length) {
    // Construct the vectorized inputs from the scalar cases
    const packedInputs = new Array(parameterTypes.length);
    for (let paramIdx = 0; paramIdx < parameterTypes.length; paramIdx++) {
      const inputElements = new Array(vectorWidth);
      for (let i = 0; i < vectorWidth; i++) {
        const input = cases[clampCaseIdx(caseIdx + i)].input;
        inputElements[i] = input instanceof Array ? input[paramIdx] : input;
      }
      packedInputs[paramIdx] = new Vector(inputElements);
    }

    // Gather the comparators for the packed cases
    const comparators = new Array(vectorWidth);
    for (let i = 0; i < vectorWidth; i++) {
      comparators[i] = toComparator(cases[clampCaseIdx(caseIdx + i)].expected);
    }
    const packedComparator = got => {
      let matched = true;
      const gElements = new Array(vectorWidth);
      const eElements = new Array(vectorWidth);
      for (let i = 0; i < vectorWidth; i++) {
        const d = comparators[i](got.elements[i]);
        matched = matched && d.matched;
        gElements[i] = d.got;
        eElements[i] = d.expected;
      }
      return {
        matched,
        got: `${packedReturnType}(${gElements.join(', ')})`,
        expected: `${packedReturnType}(${eElements.join(', ')})`,
      };
    };

    // Append the new packed case
    packedCases.push({ input: packedInputs, expected: packedComparator });
    caseIdx += vectorWidth;
  }

  return {
    cases: packedCases,
    parameterTypes: packedParameterTypes,
    returnType: packedReturnType,
  };
}

/**
 * Indicates bounds that acceptance intervals need to be within to avoid inputs
 * being filtered out. This is used for const-eval tests, since going OOB will
 * cause a validation error not an execution error.
 */

// No expectations

/**
 * @returns a Case for the param and unary interval generator provided
 * The Case will use use an interval comparator for matching results.
 * @param param the param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for an
 *            unary operation
 */
function makeUnaryToF32IntervalCase(param, filter, ...ops) {
  param = quantizeToF32(param);

  const intervals = ops.map(o => o(param));
  if (filter === 'f32-only' && intervals.some(i => !i.isFinite())) {
    return undefined;
  }
  return { input: [f32(param)], expected: anyOf(...intervals) };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param params array of inputs to try
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for an
 *            unary operation
 */
export function generateUnaryToF32IntervalCases(params, filter, ...ops) {
  return params.reduce((cases, e) => {
    const c = makeUnaryToF32IntervalCase(e, filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the params and binary interval generator provided
 * The Case will use use an interval comparator for matching results.
 * @param param0 the first param or left hand side to pass in
 * @param param1 the second param or rhs hand side to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for a
 *            binary operation
 */
function makeBinaryToF32IntervalCase(param0, param1, filter, ...ops) {
  param0 = quantizeToF32(param0);
  param1 = quantizeToF32(param1);

  const intervals = ops.map(o => o(param0, param1));
  if (filter === 'f32-only' && intervals.some(i => !i.isFinite())) {
    return undefined;
  }
  return { input: [f32(param0), f32(param1)], expected: anyOf(...intervals) };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param param0s array of inputs to try for the first param
 * @param param1s array of inputs to try for the second param
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for a
 *            binary operation
 */
export function generateBinaryToF32IntervalCases(param0s, param1s, filter, ...ops) {
  return cartesianProduct(param0s, param1s).reduce((cases, e) => {
    const c = makeBinaryToF32IntervalCase(e[0], e[1], filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the params and ternary interval generator provided
 * The Case will use use an interval comparator for matching results.
 * @param param0 the first param to pass in
 * @param param1 the second param to pass in
 * @param param2 the third param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for a
 *            ternary operation.
 */
function makeTernaryToF32IntervalCase(param0, param1, param2, filter, ...ops) {
  param0 = quantizeToF32(param0);
  param1 = quantizeToF32(param1);
  param2 = quantizeToF32(param2);

  const intervals = ops.map(o => o(param0, param1, param2));
  if (filter === 'f32-only' && intervals.some(i => !i.isFinite())) {
    return undefined;
  }
  return {
    input: [f32(param0), f32(param1), f32(param2)],
    expected: anyOf(...intervals),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param param0s array of inputs to try for the first param
 * @param param1s array of inputs to try for the second param
 * @param param2s array of inputs to try for the third param
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for a
 *            ternary operation.
 */
export function generateTernaryToF32IntervalCases(param0s, param1s, param2s, filter, ...ops) {
  return cartesianProduct(param0s, param1s, param2s).reduce((cases, e) => {
    const c = makeTernaryToF32IntervalCase(e[0], e[1], e[2], filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the param and vector interval generator provided
 * @param param the param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for a
 *            vector.
 */
function makeVectorToF32IntervalCase(param, filter, ...ops) {
  param = param.map(quantizeToF32);
  const param_f32 = param.map(f32);

  const intervals = ops.map(o => o(param));
  if (filter === 'f32-only' && intervals.some(i => !i.isFinite())) {
    return undefined;
  }
  return {
    input: [new Vector(param_f32)],
    expected: anyOf(...intervals),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param params array of inputs to try
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for a
 *            vector.
 */
export function generateVectorToF32IntervalCases(params, filter, ...ops) {
  return params.reduce((cases, e) => {
    const c = makeVectorToF32IntervalCase(e, filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the params and vector pair interval generator provided
 * @param param0 the first param to pass in
 * @param param1 the second param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for a
 *            pair of vectors.
 */
function makeVectorPairToF32IntervalCase(param0, param1, filter, ...ops) {
  param0 = param0.map(quantizeToF32);
  param1 = param1.map(quantizeToF32);
  const param0_f32 = param0.map(f32);
  const param1_f32 = param1.map(f32);

  const intervals = ops.map(o => o(param0, param1));
  if (filter === 'f32-only' && intervals.some(i => !i.isFinite())) {
    return undefined;
  }
  return {
    input: [new Vector(param0_f32), new Vector(param1_f32)],
    expected: anyOf(...intervals),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param param0s array of inputs to try for the first input
 * @param param1s array of inputs to try for the second input
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance interval for a
 *            pair of vectors.
 */
export function generateVectorPairToF32IntervalCases(param0s, param1s, filter, ...ops) {
  return cartesianProduct(param0s, param1s).reduce((cases, e) => {
    const c = makeVectorPairToF32IntervalCase(e[0], e[1], filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the param and vector of intervals generator provided
 * @param param the param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an vector of acceptance
 *            intervals for a vector.
 */
function makeVectorToVectorCase(param, filter, ...ops) {
  param = param.map(quantizeToF32);
  const param_f32 = param.map(f32);

  const vectors = ops.map(o => o(param));
  if (filter === 'f32-only' && vectors.some(v => v.some(e => !e.isFinite()))) {
    return undefined;
  }
  return {
    input: [new Vector(param_f32)],
    expected: anyOf(...vectors),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param params array of inputs to try
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an vector of acceptance
 *            intervals for a vector.
 */
export function generateVectorToVectorCases(params, filter, ...ops) {
  return params.reduce((cases, e) => {
    const c = makeVectorToVectorCase(e, filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the params and vector of intervals generator provided
 * @param param0 the first param to pass in
 * @param param1 the second param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an vector of acceptance
 *            intervals for a pair of vectors.
 */
function makeVectorPairToVectorCase(param0, param1, filter, ...ops) {
  param0 = param0.map(quantizeToF32);
  param1 = param1.map(quantizeToF32);
  const param0_f32 = param0.map(f32);
  const param1_f32 = param1.map(f32);

  const vectors = ops.map(o => o(param0, param1));
  if (filter === 'f32-only' && vectors.some(v => v.some(e => !e.isFinite()))) {
    return undefined;
  }
  return {
    input: [new Vector(param0_f32), new Vector(param1_f32)],
    expected: anyOf(...vectors),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param param0s array of inputs to try for the first input
 * @param param1s array of inputs to try for the second input
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an vector of acceptance
 *            intervals for a pair of vectors.
 */
export function generateVectorPairToVectorCases(param0s, param1s, filter, ...ops) {
  return cartesianProduct(param0s, param1s).reduce((cases, e) => {
    const c = makeVectorPairToVectorCase(e[0], e[1], filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the param and an array of interval generators provided
 * @param param the param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating a matrix of acceptance
 *            intervals for a matrix.
 */
function makeMatrixToMatrixCase(param, filter, ...ops) {
  param = map2DArray(param, quantizeToF32);
  const param_f32 = map2DArray(param, f32);

  const results = ops.map(o => o(param));
  if (filter === 'f32-only' && results.some(m => m.some(c => c.some(r => !r.isFinite())))) {
    return undefined;
  }

  return {
    input: [new Matrix(param_f32)],
    expected: anyOf(...results),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param params array of inputs to try
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating a matrix of acceptance
 *            intervals for a matrix.
 */
export function generateMatrixToMatrixCases(params, filter, ...ops) {
  return params.reduce((cases, e) => {
    const c = makeMatrixToMatrixCase(e, filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the params and matrix of intervals generator provided
 * @param param0 the first param to pass in
 * @param param1 the second param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an matrix of acceptance
 *            intervals for a pair of matrices.
 */
function makeMatrixPairToMatrixCase(param0, param1, filter, ...ops) {
  param0 = map2DArray(param0, quantizeToF32);
  param1 = map2DArray(param1, quantizeToF32);
  const param0_f32 = map2DArray(param0, f32);
  const param1_f32 = map2DArray(param1, f32);

  const results = ops.map(o => o(param0, param1));
  if (filter === 'f32-only' && results.some(m => m.some(c => c.some(r => !r.isFinite())))) {
    return undefined;
  }
  return {
    input: [new Matrix(param0_f32), new Matrix(param1_f32)],
    expected: anyOf(...results),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param param0s array of inputs to try for the first input
 * @param param1s array of inputs to try for the second input
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an matrix of acceptance
 *            intervals for a pair of matrices.
 */
export function generateMatrixPairToMatrixCases(param0s, param1s, filter, ...ops) {
  return cartesianProduct(param0s, param1s).reduce((cases, e) => {
    const c = makeMatrixPairToMatrixCase(e[0], e[1], filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the params and matrix of intervals generator provided
 * @param mat the matrix param to pass in
 * @param scalar the scalar to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an matrix of acceptance
 *            intervals for a pair of matrices.
 */
function makeMatrixScalarToMatrixCase(mat, scalar, filter, ...ops) {
  mat = map2DArray(mat, quantizeToF32);
  scalar = quantizeToF32(scalar);
  const mat_f32 = map2DArray(mat, f32);
  const scalar_f32 = f32(scalar);

  const results = ops.map(o => o(mat, scalar));
  if (filter === 'f32-only' && results.some(m => m.some(c => c.some(r => !r.isFinite())))) {
    return undefined;
  }
  return {
    input: [new Matrix(mat_f32), scalar_f32],
    expected: anyOf(...results),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param mats array of inputs to try for the matrix input
 * @param scalars array of inputs to try for the scalar input
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an matrix of acceptance
 *            intervals for a pair of matrices.
 */
export function generateMatrixScalarToMatrixCases(mats, scalars, filter, ...ops) {
  // Cannot use cartesianProduct here, due to heterogeneous types
  const cases = [];
  mats.forEach(mat => {
    scalars.forEach(scalar => {
      const c = makeMatrixScalarToMatrixCase(mat, scalar, filter, ...ops);
      if (c !== undefined) {
        cases.push(c);
      }
    });
  });
  return cases;
}

/**
 * @returns a Case for the params and matrix of intervals generator provided
 * @param mat the matrix param to pass in
 * @param scalar the scalar to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an matrix of acceptance
 *            intervals for a pair of matrices.
 */
function makeScalarMatrixToMatrixCase(scalar, mat, filter, ...ops) {
  mat = map2DArray(mat, quantizeToF32);
  scalar = quantizeToF32(scalar);
  const mat_f32 = map2DArray(mat, f32);
  const scalar_f32 = f32(scalar);

  const results = ops.map(o => o(scalar, mat));
  if (filter === 'f32-only' && results.some(m => m.some(c => c.some(r => !r.isFinite())))) {
    return undefined;
  }
  return {
    input: [scalar_f32, new Matrix(mat_f32)],
    expected: anyOf(...results),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param scalars array of inputs to try for the scalar input
 * @param mats array of inputs to try for the matrix input
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an matrix of acceptance
 *            intervals for a pair of matrices.
 */
export function generateScalarMatrixToMatrixCases(scalars, mats, filter, ...ops) {
  // Cannot use cartesianProduct here, due to heterogeneous types
  const cases = [];
  mats.forEach(mat => {
    scalars.forEach(scalar => {
      const c = makeScalarMatrixToMatrixCase(scalar, mat, filter, ...ops);
      if (c !== undefined) {
        cases.push(c);
      }
    });
  });
  return cases;
}

/**
 * @returns a Case for the params and the vector of intervals generator provided
 * @param mat the matrix param to pass in
 * @param vec the vector to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating a vector of acceptance
 *            intervals for a matrix and a vector.
 */
function makeMatrixVectorToVectorCase(mat, vec, filter, ...ops) {
  mat = map2DArray(mat, quantizeToF32);
  vec = vec.map(quantizeToF32);
  const mat_f32 = map2DArray(mat, f32);
  const vec_f32 = vec.map(f32);

  const results = ops.map(o => o(mat, vec));
  if (filter === 'f32-only' && results.some(v => v.some(e => !e.isFinite()))) {
    return undefined;
  }
  return {
    input: [new Matrix(mat_f32), new Vector(vec_f32)],
    expected: anyOf(...results),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param mats array of inputs to try for the matrix input
 * @param vecs array of inputs to try for the vector input
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating a vector of acceptance
 *            intervals for a matrix and a vector.
 */
export function generateMatrixVectorToVectorCases(mats, vecs, filter, ...ops) {
  // Cannot use cartesianProduct here, due to heterogeneous types
  const cases = [];
  mats.forEach(mat => {
    vecs.forEach(vec => {
      const c = makeMatrixVectorToVectorCase(mat, vec, filter, ...ops);
      if (c !== undefined) {
        cases.push(c);
      }
    });
  });
  return cases;
}

/**
 * @returns a Case for the params and the vector of intervals generator provided
 * @param vec the vector to pass in
 * @param mat the matrix param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating a vector of acceptance
 *            intervals for a vector and a matrix.
 */
function makeVectorMatrixToVectorCase(vec, mat, filter, ...ops) {
  vec = vec.map(quantizeToF32);
  mat = map2DArray(mat, quantizeToF32);
  const vec_f32 = vec.map(f32);
  const mat_f32 = map2DArray(mat, f32);

  const results = ops.map(o => o(vec, mat));
  if (filter === 'f32-only' && results.some(v => v.some(e => !e.isFinite()))) {
    return undefined;
  }
  return {
    input: [new Vector(vec_f32), new Matrix(mat_f32)],
    expected: anyOf(...results),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param vecs array of inputs to try for the vector input
 * @param mats array of inputs to try for the matrix input
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating a vector of acceptance
 *            intervals for a vector and a matrix.
 */
export function generateVectorMatrixToVectorCases(vecs, mats, filter, ...ops) {
  // Cannot use cartesianProduct here, due to heterogeneous types
  const cases = [];
  vecs.forEach(vec => {
    mats.forEach(mat => {
      const c = makeVectorMatrixToVectorCase(vec, mat, filter, ...ops);
      if (c !== undefined) {
        cases.push(c);
      }
    });
  });
  return cases;
}

/**
 * @returns a Case for the param and vector of intervals generator provided
 * The input is treated as an unsigned int.
 * @param param the param to pass in
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance
 *            interval for an unsigned int.
 */
function makeU32ToVectorCase(param, filter, ...ops) {
  param = Math.trunc(param);
  const param_u32 = u32(param);

  const vectors = ops.map(o => o(param));
  if (filter === 'f32-only' && vectors.some(v => !v.every(e => e.isFinite()))) {
    return undefined;
  }
  return {
    input: param_u32,
    expected: anyOf(...vectors),
  };
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * The input is treated as an unsigned int.
 * @param params array of inputs to try
 * @param filter what interval filtering to apply
 * @param ops callbacks that implement generating an acceptance
 *            interval for an unsigned int.
 */
export function generateU32ToVectorCases(params, filter, ...ops) {
  return params.reduce((cases, e) => {
    const c = makeU32ToVectorCase(e, filter, ...ops);
    if (c !== undefined) {
      cases.push(c);
    }
    return cases;
  }, new Array());
}

/**
 * A function that performs a binary operation on x and y, and returns the expected
 * result.
 */

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param param0s array of inputs to try for the first param
 * @param param1s array of inputs to try for the second param
 * @param op callback called on each pair of inputs to produce each case
 */
export function generateBinaryToI32Cases(params0s, params1s, op) {
  return cartesianProduct(params0s, params1s).reduce((cases, e) => {
    const expected = op(e[0], e[1]);
    if (expected !== undefined) {
      cases.push({ input: [i32(e[0]), i32(e[1])], expected: i32(expected) });
    }
    return cases;
  }, new Array());
}

/**
 * @returns an array of Cases for operations over a range of inputs
 * @param param0s array of inputs to try for the first param
 * @param param1s array of inputs to try for the second param
 * @param op callback called on each pair of inputs to produce each case
 */
export function generateBinaryToU32Cases(params0s, params1s, op) {
  return cartesianProduct(params0s, params1s).reduce((cases, e) => {
    const expected = op(e[0], e[1]);
    if (expected !== undefined) {
      cases.push({ input: [u32(e[0]), u32(e[1])], expected: u32(expected) });
    }
    return cases;
  }, new Array());
}

/**
 * @returns a Case for the input params with op applied
 * @param scalar scalar param
 * @param vector vector param (2, 3, or 4 elements)
 * @param op the op to apply to scalar and vector
 * @param quantize function to quantize all values in vectors and scalars
 * @param scalarize function to convert numbers to Scalars
 */
function makeScalarVectorBinaryToVectorCase(scalar, vector, op, quantize, scalarize) {
  scalar = quantize(scalar);
  vector = vector.map(quantize);
  const result = vector.map(v => op(scalar, v));
  if (result.includes(undefined)) {
    return undefined;
  }
  return {
    input: [scalarize(scalar), new Vector(vector.map(scalarize))],
    expected: new Vector(result.map(scalarize)),
  };
}

/**
 * @returns array of Case for the input params with op applied
 * @param scalars array of scalar params
 * @param vectors array of vector params (2, 3, or 4 elements)
 * @param op the op to apply to each pair of scalar and vector
 * @param quantize function to quantize all values in vectors and scalars
 * @param scalarize function to convert numbers to Scalars
 */
function generateScalarVectorBinaryToVectorCases(scalars, vectors, op, quantize, scalarize) {
  const cases = new Array();
  scalars.forEach(s => {
    vectors.forEach(v => {
      const c = makeScalarVectorBinaryToVectorCase(s, v, op, quantize, scalarize);
      if (c !== undefined) {
        cases.push(c);
      }
    });
  });
  return cases;
}

/**
 * @returns a Case for the input params with op applied
 * @param vector vector param (2, 3, or 4 elements)
 * @param scalar scalar param
 * @param op the op to apply to vector and scalar
 * @param quantize function to quantize all values in vectors and scalars
 * @param scalarize function to convert numbers to Scalars
 */
function makeVectorScalarBinaryToVectorCase(vector, scalar, op, quantize, scalarize) {
  vector = vector.map(quantize);
  scalar = quantize(scalar);
  const result = vector.map(v => op(v, scalar));
  if (result.includes(undefined)) {
    return undefined;
  }
  return {
    input: [new Vector(vector.map(scalarize)), scalarize(scalar)],
    expected: new Vector(result.map(scalarize)),
  };
}

/**
 * @returns array of Case for the input params with op applied
 * @param vectors array of vector params (2, 3, or 4 elements)
 * @param scalars array of scalar params
 * @param op the op to apply to each pair of vector and scalar
 * @param quantize function to quantize all values in vectors and scalars
 * @param scalarize function to convert numbers to Scalars
 */
function generateVectorScalarBinaryToVectorCases(vectors, scalars, op, quantize, scalarize) {
  const cases = new Array();
  scalars.forEach(s => {
    vectors.forEach(v => {
      const c = makeVectorScalarBinaryToVectorCase(v, s, op, quantize, scalarize);
      if (c !== undefined) {
        cases.push(c);
      }
    });
  });
  return cases;
}

/**
 * @returns array of Case for the input params with op applied
 * @param scalars array of scalar params
 * @param vectors array of vector params (2, 3, or 4 elements)
 * @param op he op to apply to each pair of scalar and vector
 */
export function generateU32VectorBinaryToVectorCases(scalars, vectors, op) {
  return generateScalarVectorBinaryToVectorCases(scalars, vectors, op, quantizeToU32, u32);
}

/**
 * @returns array of Case for the input params with op applied
 * @param vectors array of vector params (2, 3, or 4 elements)
 * @param scalars array of scalar params
 * @param op he op to apply to each pair of vector and scalar
 */
export function generateVectorU32BinaryToVectorCases(vectors, scalars, op) {
  return generateVectorScalarBinaryToVectorCases(vectors, scalars, op, quantizeToU32, u32);
}

/**
 * @returns array of Case for the input params with op applied
 * @param scalars array of scalar params
 * @param vectors array of vector params (2, 3, or 4 elements)
 * @param op he op to apply to each pair of scalar and vector
 */
export function generateI32VectorBinaryToVectorCases(scalars, vectors, op) {
  return generateScalarVectorBinaryToVectorCases(scalars, vectors, op, quantizeToI32, i32);
}

/**
 * @returns array of Case for the input params with op applied
 * @param vectors array of vector params (2, 3, or 4 elements)
 * @param scalars array of scalar params
 * @param op he op to apply to each pair of vector and scalar
 */
export function generateVectorI32BinaryToVectorCases(vectors, scalars, op) {
  return generateVectorScalarBinaryToVectorCases(vectors, scalars, op, quantizeToI32, i32);
}