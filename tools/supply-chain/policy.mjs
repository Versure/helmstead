// Loads and validates dependency-policy.json against tools/supply-chain/dependency-policy.schema.json.
// The validator implements only the JSON Schema keywords the schema uses (type, required, properties,
// additionalProperties, items, enum, pattern, minLength, minItems, uniqueItems, $ref to #/$defs), so the
// check needs no third-party package and runs offline (spec 003, "Decisions from the interview").
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
export const POLICY_PATH = path.join(REPO_ROOT, 'dependency-policy.json');
export const SCHEMA_PATH = path.join(
  import.meta.dirname,
  'dependency-policy.schema.json',
);

/**
 * @typedef {'npm' | 'nuget'} Ecosystem
 * @typedef {{ ecosystem: Ecosystem, package: string, versionRange: string, reason: string }} LicenseException
 * @typedef {{ ecosystem: Ecosystem, package: string, advisory: string, reason: string, expires: string }} VulnerabilityException
 * @typedef {{
 *   licenses: { shipped: string[], tooling: string[] },
 *   licenseExceptions: LicenseException[],
 *   vulnerabilityExceptions: VulnerabilityException[],
 * }} Policy
 */

/** @returns {string[]} one message per problem, each starting with the JSON pointer of the value */
export function validatePolicy(policy, schema = loadSchema()) {
  const errors = [];
  check(policy, schema, '', schema, errors);
  // JSON Schema cannot say "a real calendar date"; the pattern only checks the shape.
  if (errors.length === 0) {
    policy.vulnerabilityExceptions.forEach((exception, index) => {
      if (!isCalendarDate(exception.expires)) {
        errors.push(
          `/vulnerabilityExceptions/${index}/expires: ${exception.expires} is not a calendar date`,
        );
      }
    });
  }
  return errors;
}

/** Reads and validates the repository policy. Throws with every problem listed when it is invalid. */
export function loadPolicy(file = POLICY_PATH) {
  let policy;
  try {
    policy = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `Cannot read ${path.relative(REPO_ROOT, file)}: ${error.message}`,
    );
  }
  const errors = validatePolicy(policy);
  if (errors.length > 0) {
    throw new Error(
      `${path.relative(REPO_ROOT, file)} does not match ${path.relative(REPO_ROOT, SCHEMA_PATH)}:\n` +
        errors.map((e) => `  ${e}`).join('\n'),
    );
  }
  return /** @type {Policy} */ (policy);
}

export function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function loadSchema() {
  return JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
}

const SUPPORTED = new Set([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'title',
  'description',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'enum',
  'pattern',
  'minLength',
  'minItems',
  'uniqueItems',
]);

function check(value, schema, pointer, root, errors) {
  const at = pointer || '/';
  for (const keyword of Object.keys(schema)) {
    // A keyword this validator does not know would be silently ignored, so it is an error instead.
    if (!SUPPORTED.has(keyword)) {
      throw new Error(
        `Schema keyword "${keyword}" at ${at} is not supported by tools/supply-chain/policy.mjs.`,
      );
    }
  }
  if (schema.$ref) {
    const name = /^#\/\$defs\/(.+)$/.exec(schema.$ref)?.[1];
    if (!name || !root.$defs?.[name])
      throw new Error(`Unknown $ref ${schema.$ref}`);
    check(value, root.$defs[name], pointer, root, errors);
  }
  if (schema.type && !hasType(value, schema.type)) {
    errors.push(`${at}: must be of type ${schema.type}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(
      `${at}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`,
    );
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: must be at least ${schema.minLength} characters`);
    }
    if (
      schema.pattern !== undefined &&
      !new RegExp(schema.pattern, 'u').test(value)
    ) {
      errors.push(`${at}: must match pattern ${schema.pattern}`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: must have at least ${schema.minItems} items`);
    }
    if (
      schema.uniqueItems &&
      new Set(value.map((v) => JSON.stringify(v))).size !== value.length
    ) {
      errors.push(`${at}: must not contain duplicates`);
    }
    if (schema.items) {
      value.forEach((item, index) =>
        check(item, schema.items, `${pointer}/${index}`, root, errors),
      );
    }
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at}: is missing "${key}"`);
    }
    for (const [key, item] of Object.entries(value)) {
      const propertySchema = schema.properties?.[key];
      if (propertySchema) {
        check(item, propertySchema, `${pointer}/${key}`, root, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${at}: has unknown property "${key}"`);
      }
    }
  }
}

function hasType(value, type) {
  switch (type) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    default:
      throw new Error(
        `Schema type "${type}" is not supported by tools/supply-chain/policy.mjs.`,
      );
  }
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
