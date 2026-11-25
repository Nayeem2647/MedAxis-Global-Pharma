import { AppError } from '../../shared/errors/AppError.js';
import { Exact, amount, nonnegative, saneRate } from '../../shared/utils/decimal.js';
import type { Currency } from '../../config/constants.js';

export interface FastQuoteLine {
  rfq_item_id: string;
  manufacturer_id: string;
  quantity: number;
  availability_status: 'AVAILABLE' | 'UNAVAILABLE' | 'SOURCING';
  procurement_cost_bdt?: string;
  markup_percent?: string;
  selling_price?: string;
}
export interface CommercialCalculation {
  items: Array<{ rfq_item_id: string; unit_quoted_price?: string; total_line_price?: string }>;
  subtotal_amount: string;
  freight_cost: string;
  insurance_cost: string;
  total_amount: string;
}
export interface InternalCalculation {
  items: Array<{
    rfq_item_id: string;
    manufacturer_id: string;
    procurement_unit_cost_bdt: string;
    quantity: number;
    markup_percent: string;
  }>;
  procurement_cost_bdt: string;
  target_markup_percent: string;
  calculated_base_bdt: string;
  gross_margin_bdt: string;
  effective_gross_margin_percent: string;
}
export function calculateFastQuote(input: {
  currency: Currency;
  rate_to_bdt: string;
  items: FastQuoteLine[];
  freight_amount: string;
  insurance_amount: string;
}): {
  commercial: CommercialCalculation;
  internal: InternalCalculation;
} {
  if (
    !input.items.length ||
    input.items.length > 100 ||
    !saneRate(input.rate_to_bdt) ||
    (input.currency === 'BDT' && !new Exact(input.rate_to_bdt).eq(1))
  )
    throw AppError.validation([{ field: 'items', issue: 'Invalid quote lines or conversion rate.' }]);
  const rate = new Exact(input.rate_to_bdt);
  const commercial: CommercialCalculation = {
    items: [],
    subtotal_amount: '0.00',
    freight_cost: amount(nonnegative(input.freight_amount, 'freight_amount')),
    insurance_cost: amount(nonnegative(input.insurance_amount, 'insurance_amount')),
    total_amount: '0.00',
  };
  const internal: InternalCalculation = {
    items: [],
    procurement_cost_bdt: '0',
    target_markup_percent: '0',
    calculated_base_bdt: '0',
    gross_margin_bdt: '0',
    effective_gross_margin_percent: '0',
  };
  let subtotal = new Exact(0);
  let procurement = new Exact(0);
  let markedUp = new Exact(0);
  for (const line of input.items) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1)
      throw AppError.validation([{ field: 'quantity', issue: 'Quantity must be a positive safe integer.' }]);
    const cost =
      line.procurement_cost_bdt === undefined
        ? undefined
        : nonnegative(line.procurement_cost_bdt, 'procurement_cost_bdt');
    const markup = line.markup_percent === undefined ? undefined : nonnegative(line.markup_percent, 'markup_percent');
    if (markup?.gt('1000000'))
      throw AppError.validation([{ field: 'markup_percent', issue: 'Markup exceeds the supported range.' }]);
    if (line.availability_status !== 'AVAILABLE') {
      commercial.items.push({ rfq_item_id: line.rfq_item_id });
      continue;
    }
    if ((!cost || !markup) && line.selling_price === undefined)
      throw AppError.validation([{ field: 'items', issue: 'Available lines require cost and markup.' }]);
    const sourceCost = cost ?? new Exact(0);
    const sourceMarkup = markup ?? new Exact(0);
    const markedUnit = line.selling_price === undefined ? sourceCost.mul(new Exact(1).plus(sourceMarkup.div(100))) : nonnegative(line.selling_price, 'selling_price').mul(rate);
    const unit = amount(markedUnit.div(rate));
    const total = new Exact(unit).mul(String(line.quantity));
    commercial.items.push({ rfq_item_id: line.rfq_item_id, unit_quoted_price: unit, total_line_price: amount(total) });
    subtotal = subtotal.plus(total);
    procurement = procurement.plus(sourceCost.mul(String(line.quantity)));
    markedUp = markedUp.plus(markedUnit.mul(String(line.quantity)));
    internal.items.push({
      rfq_item_id: line.rfq_item_id,
      manufacturer_id: line.manufacturer_id,
      procurement_unit_cost_bdt: amount(sourceCost, 8),
      quantity: line.quantity,
      markup_percent: amount(sourceMarkup, 8),
    });
  }
  if (!internal.items.length)
    throw AppError.validation([{ field: 'items', issue: 'A quote requires at least one available line.' }]);
  commercial.subtotal_amount = amount(subtotal);
  commercial.total_amount = amount(subtotal.plus(commercial.freight_cost).plus(commercial.insurance_cost));
  const base = subtotal.mul(rate);
  const margin = base.minus(procurement);
  internal.procurement_cost_bdt = amount(procurement, 8);
  internal.calculated_base_bdt = amount(base, 8);
  internal.gross_margin_bdt = amount(margin, 8);
  internal.target_markup_percent = amount(
    procurement.eq(0) ? new Exact(0) : markedUp.div(procurement).minus(1).mul(100),
    8,
  );
  internal.effective_gross_margin_percent = amount(base.eq(0) ? new Exact(0) : margin.div(base).mul(100), 8);
  return { commercial, internal };
}
