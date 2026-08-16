import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../lib/index.js'

/**
 * Regression guard for the raw JSON Schema subset enforced by dsh's
 * `ctx.tools.register` (assertSupportedJsonSchema in @deepseek-ai/dsh-tools).
 *
 * The plugin ships a no-op `defineTool` shim (see node_modules/), so the
 * author-facing value-schema DSL is NEVER compiled at runtime: whatever
 * lands in `tool.output.schema` is asserted verbatim by the registry.
 *
 * Supported subset (mirrors dsh-tools):
 * - type: single string, one of object/array/string/number/integer/boolean/null
 * - oneOf: array of >= 2 schemas, no sibling keywords
 * - properties: only on object nodes; required: array of strings naming properties
 * - additionalProperties: boolean only
 * - items: only on array nodes; enum/const only on scalar nodes
 * - annotations: description/title/default/examples
 */

const TYPES = ['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']
const SCALAR_TYPES = ['string', 'number', 'integer', 'boolean', 'null']
const ANNOTATIONS = ['description', 'title', 'default', 'examples']
const ONE_OF_SIBLINGS = ['properties', 'required', 'additionalProperties', 'items', 'enum', 'const']
// Mirrors dsh-tools: each constraint keyword is only meaningful on certain node types
const KEYWORD_TYPES = {
  properties: ['object'],
  required: ['object'],
  additionalProperties: ['object'],
  items: ['array'],
  enum: SCALAR_TYPES,
  const: SCALAR_TYPES
}

function collectViolations(schema, path, out) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    out.push(`${path} must be a schema object`)
    return
  }
  for (const key of Object.keys(schema)) {
    if (key === 'type' || key === 'oneOf' || KEYWORD_TYPES[key] || ANNOTATIONS.includes(key)) continue
    out.push(`${path}.${key} is not a supported keyword`)
  }

  const hasType = Object.hasOwn(schema, 'type')
  const hasOneOf = Object.hasOwn(schema, 'oneOf')
  if (hasType && hasOneOf) {
    out.push(`${path} cannot declare both type and oneOf`)
    return
  }
  if (hasOneOf) {
    for (const key of ONE_OF_SIBLINGS) if (Object.hasOwn(schema, key)) out.push(`${path}.${key} is not supported beside oneOf`)
    if (!Array.isArray(schema.oneOf) || schema.oneOf.length < 2) {
      out.push(`${path}.oneOf must be an array of at least two schemas`)
    } else {
      schema.oneOf.forEach((branch, i) => collectViolations(branch, `${path}.oneOf[${i}]`, out))
    }
    return
  }
  if (!hasType) {
    out.push(`${path} requires type or oneOf`)
    return
  }
  const type = schema.type
  if (typeof type !== 'string' || !TYPES.includes(type)) {
    out.push(`${path}.type must be one of ${TYPES.join('/')}`)
    return
  }

  for (const [key, allowedTypes] of Object.entries(KEYWORD_TYPES)) {
    if (Object.hasOwn(schema, key) && !allowedTypes.includes(type)) {
      out.push(`${path}.${key} is not supported on type "${type}"`)
    }
  }

  if (type === 'object') {
    if (Object.hasOwn(schema, 'properties')) {
      if (typeof schema.properties !== 'object' || schema.properties === null || Array.isArray(schema.properties)) {
        out.push(`${path}.properties must be an object of schemas`)
      } else {
        for (const [name, prop] of Object.entries(schema.properties)) {
          collectViolations(prop, `${path}.properties.${name}`, out)
        }
      }
    }
    if (Object.hasOwn(schema, 'required')) {
      if (!Array.isArray(schema.required) || schema.required.some((r) => typeof r !== 'string')) {
        out.push(`${path}.required must be an array of strings`)
      } else {
        for (const name of schema.required) {
          if (!schema.properties || !Object.hasOwn(schema.properties, name)) {
            out.push(`${path}.required names "${name}" which is not in properties`)
          }
        }
      }
    }
  } else if (type === 'array') {
    if (Object.hasOwn(schema, 'items')) collectViolations(schema.items, `${path}.items`, out)
  } else if (SCALAR_TYPES.includes(type)) {
    if (Object.hasOwn(schema, 'enum') && (!Array.isArray(schema.enum) || schema.enum.length === 0)) {
      out.push(`${path}.enum must be a non-empty array of ${type} values`)
    }
    if (Object.hasOwn(schema, 'const') && !(type === 'null' ? schema.const === null : typeof schema.const === type)) {
      out.push(`${path}.const must be a ${type} value`)
    }
  }
}

function makeCtx() {
  return {
    tools: { register() { return () => {} } },
    systemPrompt: { section() {} },
    shellEnv: { collect() { return {} } },
    shell: { resolve: (r) => r, async run() { throw new Error('not executed during registration') } },
    get() { return undefined },
    on() {}
  }
}

test('output.schema and parameters of every registered tool conform to the dsh raw schema subset', () => {
  const schemas = []
  const ctx = makeCtx()
  ctx.tools.register = (tool) => {
    schemas.push({ name: tool.name, output: tool.output.schema, parameters: tool.parameters })
    return () => {}
  }
  apply(ctx)

  assert.ok(schemas.length >= 2, 'expected pwsh and rtk tools to be registered')

  for (const { name, output, parameters } of schemas) {
    const violations = []
    collectViolations(output, 'schema', violations)
    assert.deepEqual(violations, [], `tool "${name}" output.schema is not a valid dsh raw schema`)

    // parameters are forwarded to the LLM provider verbatim (schemaOf() deep-copies
    // them without compiling), so they must also be raw JSON Schema.
    const paramViolations = []
    collectViolations(parameters, 'parameters', paramViolations)
    assert.deepEqual(paramViolations, [], `tool "${name}" parameters is not a valid dsh raw schema`)
  }
})

test('boolean "required" markers would be rejected (regression shape)', () => {
  // Documents why property-level `required: true` is illegal in the raw subset
  const violations = []
  collectViolations(
    { type: 'object', properties: { kind: { type: 'string', required: true } } },
    'schema',
    violations
  )
  assert.ok(violations.length > 0)
  assert.ok(violations.some((v) => v.includes('required is not supported on type "string"')))
})