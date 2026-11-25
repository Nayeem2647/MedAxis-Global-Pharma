import baseValidators from './validators.json' with { type: 'json' };
import { customerAccountValidators } from '../../modules/customer/account.validators.js';

const workflowValidators = {
  rfqs: { ...baseValidators.rfqs, properties: { ...baseValidators.rfqs.properties,
    workflow: { bsonType: 'object' }, guest_token_hash: { bsonType: 'string', pattern: '^[a-f0-9]{64}$' }, guest_delivery: { bsonType: 'object' }, guest_expires_at: { bsonType: 'date' }, guest_revoked_at: { bsonType: 'date' },
  } },
  quotation_versions: { ...baseValidators.quotation_versions, properties: { ...baseValidators.quotation_versions.properties,
    workflow_enabled: { bsonType: 'bool' }, medicine_weight_g: { bsonType: 'decimal' }, packed_weight_g: { bsonType: 'decimal' }, payment_requested_at: { bsonType: 'date' }, delivery_evidence: { bsonType: 'string', maxLength: 2000 },
    items: { ...baseValidators.quotation_versions.properties.items, items: { ...baseValidators.quotation_versions.properties.items.items, properties: { ...baseValidators.quotation_versions.properties.items.items.properties,
      weight_per_pack_g: { bsonType: 'decimal' }, line_weight_g: { bsonType: 'decimal' }, selling_price_override: { bsonType: 'decimal' },
    } } },
  } },
  prescriptions: { ...baseValidators.prescriptions, properties: { ...baseValidators.prescriptions.properties,
    attachment_kind: { bsonType: 'string', enum: ['PRESCRIPTION', 'SUPPORTING'] },
  } },
};
export default { ...baseValidators, ...workflowValidators, ...customerAccountValidators };
