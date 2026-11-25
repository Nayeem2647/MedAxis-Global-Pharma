import type { IQuotationVersion } from './quotation.schema.js';
import { bankDetailsSchema } from '../../shared/validators/quotation.validator.js';

export const COMMERCIAL_PROJECTION =
  'quotation_id version_number status contact_snapshot items billing_currency subtotal_amount freight_cost insurance_cost total_amount shipping_terms payment_terms bank_details_snapshot issued_at valid_until accepted_at reservation_expires_at reservation_status payment shipment delivered_at created_at updated_at medicine_weight_g packed_weight_g payment_requested_at workflow_enabled';

/** Shared with the later buyer routes: construct every field and nested line explicitly. */
export function commercialQuotation(version: IQuotationVersion) {
  const bank = bankDetailsSchema.safeParse(version.bank_details_snapshot);
  return {
    id: version._id,
    quotation_id: version.quotation_id,
    version_number: version.version_number,
    status: version.status,
    contact: {
      full_name: version.contact_snapshot.full_name,
      customer_type: version.contact_snapshot.customer_type,
      company_name: version.contact_snapshot.company_name,
      email: version.contact_snapshot.email,
      whatsapp_number: version.contact_snapshot.whatsapp_number,
      wechat_id: version.contact_snapshot.wechat_id,
      preferred_locale: version.contact_snapshot.preferred_locale,
    },
    items: version.items.map((line) => ({
      id: line._id,
      rfq_item_id: line.rfq_item_id,
      product_id: line.product_id,
      manufacturer_id: line.manufacturer_id,
      brand_name: line.brand_name_snapshot,
      generic_name: line.generic_name_snapshot,
      strength: line.strength_snapshot,
      dosage_form: line.dosage_form_snapshot,
      pack_size: line.pack_size_snapshot,
      packaging_unit: line.packaging_unit,
      quantity: line.quantity,
      availability_status: line.availability_status,
      customer_facing_note: line.customer_facing_note,
      unit_quoted_price: line.unit_quoted_price?.toString(),
      total_line_price: line.total_line_price?.toString(),
      weight_per_pack_g: line.weight_per_pack_g?.toString(),
      line_weight_g: line.line_weight_g?.toString(),
    })),
    billing_currency: version.billing_currency,
    subtotal_amount: version.subtotal_amount.toString(),
    freight_cost: version.freight_cost.toString(),
    insurance_cost: version.insurance_cost.toString(),
    total_amount: version.total_amount.toString(),
    medicine_weight_g: version.medicine_weight_g?.toString(),
    packed_weight_g: version.packed_weight_g?.toString(),
    payment_requested_at: version.payment_requested_at,
    shipping_terms: {
      method: version.shipping_terms.method,
      incoterm: version.shipping_terms.incoterm,
      named_place: version.shipping_terms.named_place,
      cold_chain_required: version.shipping_terms.cold_chain_required,
      temperature_range: version.shipping_terms.temperature_range,
    },
    payment_terms: version.payment_terms,
    bank_details: bank.success ? bank.data : undefined,
    issued_at: version.issued_at,
    valid_until: version.valid_until,
    accepted_at: version.accepted_at,
    reservation_expires_at: version.reservation_expires_at,
    payment: version.payment
      ? {
          reference: version.payment.reference,
          amount: version.payment.amount.toString(),
          currency: version.payment.currency,
          received_at: version.payment.received_at,
        }
      : undefined,
    shipment: version.shipment
      ? {
          courier_name: version.shipment.courier_name,
          awb_tracking_number: version.shipment.awb_number,
          dispatched_at: version.shipment.dispatched_at,
          estimated_delivery: version.shipment.estimated_delivery,
        }
      : undefined,
    delivered_at: version.delivered_at,
    reservation_status: version.reservation_status,
    created_at: version.created_at,
    updated_at: version.updated_at,
  };
}

export type CustomerQuotationDto = ReturnType<typeof commercialQuotation>;
