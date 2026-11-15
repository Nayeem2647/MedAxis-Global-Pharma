import { randomUUID } from 'node:crypto';
import type { IQuotationVersion } from '../../src/modules/quotation/quotation.schema.js';
import { commercialQuotation } from '../../src/modules/quotation/quotation.dto.js';
import { bsonDecimal } from '../../src/shared/utils/decimal.js';
import type { PdfInput } from '../../src/modules/pdf/pdf.template.js';

export function quotationVersionFixture(accepted = false): IQuotationVersion {
  return {
    _id: randomUUID(),
    quotation_id: randomUUID(),
    version_number: 1,
    status: accepted ? 'ACCEPTED' : 'SENT',
    contact_snapshot: {
      full_name: '测试买家',
      customer_type: 'B2C_PATIENT',
      email: 'buyer@example.test',
      preferred_locale: 'zh-CN',
    },
    items: [
      {
        _id: randomUUID(),
        rfq_item_id: randomUUID(),
        manufacturer_id: randomUUID(),
        brand_name_snapshot: '测试药品',
        generic_name_snapshot: '通用药名',
        strength_snapshot: '10mg',
        dosage_form_snapshot: '片剂',
        pack_size_snapshot: '10片',
        packaging_unit: 'BOX',
        quantity: 3,
        availability_status: 'AVAILABLE',
        unit_quoted_price: bsonDecimal('1.20'),
        total_line_price: bsonDecimal('3.60'),
      },
    ],
    billing_currency: 'USD',
    subtotal_amount: bsonDecimal('3.60'),
    freight_cost: bsonDecimal('2.50'),
    insurance_cost: bsonDecimal('0.25'),
    total_amount: bsonDecimal('6.35'),
    shipping_terms: { method: 'EXPRESS_COURIER', named_place: '北京', cold_chain_required: false },
    payment_terms: 'BANK_WIRE_TT',
    issued_at: new Date('2026-11-15T10:00:00Z'),
    valid_until: new Date('2026-11-22T10:00:00Z'),
    reservation_status: accepted ? 'ACTIVE' : 'NONE',
    accepted_at: accepted ? new Date('2026-11-16T10:00:00Z') : undefined,
    reservation_expires_at: accepted ? new Date('2026-11-21T10:00:00Z') : undefined,
    created_at: new Date(),
    updated_at: new Date(),
  };
}
export function pdfFixture(accepted = false): PdfInput {
  const version = quotationVersionFixture(accepted);
  return {
    version: commercialQuotation(version),
    quotation_number: 'QT-TEST-001',
    mode: accepted ? 'ACCEPTED_QUOTE' : 'ORIGINAL_QUOTE',
    branding: { name: 'MedAxis Global Pharma' },
    wire_details: {
      configured: true,
      instructions: '请注明报价单编号',
      beneficiary_name: 'MedAxis Exporter',
      bank_name: '中国测试银行',
      account_number: '123456789',
      swift_code: 'TESTBDDH',
    },
  };
}
