import Ajv from 'ajv';
import draft4 from 'ajv/lib/refs/json-schema-draft-04.json' with { type: 'json' };
import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import validators from '../src/shared/persistence/validators.js';
import { RFQ_STATUS } from '../src/config/constants.js';
import { rfqRecord } from './fixtures/rfq.js';

// AJV evaluates the JSON Schema keywords; this keyword supplies MongoDB's BSON types.
// The database suite separately verifies these contracts using MongoDB itself.
const ajv = new Ajv({ allErrors: true, schemaId: 'id', meta: false });
ajv.addMetaSchema(draft4);
ajv.addKeyword('bsonType', {
  metaSchema: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
  errors: false,
  validate: (types: string | string[], value: unknown): boolean =>
    (Array.isArray(types) ? types : [types]).some((type) => {
      switch (type) {
        case 'object':
          return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
        case 'array':
          return Array.isArray(value);
        case 'string':
          return typeof value === 'string';
        case 'bool':
          return typeof value === 'boolean';
        case 'date':
          return value instanceof Date && Number.isFinite(value.getTime());
        case 'int':
          return Number.isInteger(value) && Number(value) >= -2_147_483_648 && Number(value) <= 2_147_483_647;
        case 'long':
          return Number.isSafeInteger(value);
        case 'decimal':
          return value instanceof Types.Decimal128;
        default:
          throw new Error(`Unsupported test BSON type: ${type}`);
      }
    }),
});
const compile = (schema: object) => ajv.compile({ ...schema, $schema: draft4.id });
const validateRfq = compile(validators.rfqs);

describe('MongoDB JSON Schema contracts', () => {
  it.each(Object.entries(validators))(
    'compiles the %s schema without invalid keywords or empty required arrays',
    (_name, schema) => {
      expect(() => compile(schema)).not.toThrow();
    },
  );

  it.each(Object.values(RFQ_STATUS))('accepts a complete RFQ with status %s', (status) => {
    expect(validateRfq({ ...rfqRecord(), status })).toBe(true);
  });

  it.each(['INVALID', 'DRAFT', '', null])('rejects RFQ status %s using the schema enum', (status) => {
    expect(validateRfq({ ...rfqRecord(), status })).toBe(false);
    expect(validateRfq.errors).toContainEqual(expect.objectContaining({ keyword: 'enum', dataPath: '.status' }));
  });

  it.each([0, -1])('rejects RFQ quantity %s using the schema minimum', (quantity) => {
    const record = rfqRecord();
    record.items[0]!.quantity = quantity;
    expect(validateRfq(record)).toBe(false);
    expect(validateRfq.errors).toContainEqual(
      expect.objectContaining({ keyword: 'minimum', dataPath: '.items[0].quantity' }),
    );
  });

  it('rejects fractional quantities and preserves the inclusive quantity boundary', () => {
    const record = rfqRecord();
    record.items[0]!.quantity = 0.5;
    expect(validateRfq(record)).toBe(false);
    expect(validateRfq.errors).toContainEqual(
      expect.objectContaining({ keyword: 'bsonType', dataPath: '.items[0].quantity' }),
    );
    record.items[0]!.quantity = 1;
    expect(validateRfq(record)).toBe(true);
  });
});
