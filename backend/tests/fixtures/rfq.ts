import { randomUUID } from 'node:crypto';
import type { IRfq } from '../../src/modules/rfq/rfq.schema.js';

/** Complete BSON-ready record so validator tests bypass Mongoose casting and defaults. */
export function rfqRecord(): IRfq {
  return {
    _id: randomUUID(),
    rfq_number: `RFQ-TEST-${randomUUID()}`,
    customer_id: randomUUID(),
    inquiry_type: 'CART_RFQ',
    contact_snapshot: {
      full_name: 'Test Buyer',
      customer_type: 'B2C_PATIENT',
      email: 'buyer@example.test',
      preferred_locale: 'en',
    },
    destination_country: 'BD',
    preferred_currency: 'USD',
    status: 'SUBMITTED',
    has_prescription: false,
    items: [
      {
        _id: randomUUID(),
        is_uncatalogued: true,
        custom_medicine_name: 'Test Medicine',
        quantity: 1,
        packaging_unit: 'BOX',
        item_availability_status: 'SOURCING',
      },
    ],
    created_at: new Date(),
    updated_at: new Date(),
  };
}
