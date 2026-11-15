import type { CustomerQuotationDto } from '../quotation/quotation.dto.js';
import type { z } from 'zod';
import type { bankDetailsSchema } from '../../shared/validators/quotation.validator.js';

export type PdfMode = 'ORIGINAL_QUOTE' | 'ACCEPTED_QUOTE' | 'PROFORMA';
export interface PdfInput {
  version: CustomerQuotationDto;
  quotation_number: string;
  wire_details: z.infer<typeof bankDetailsSchema>;
  branding: { name: string; address?: string; email?: string };
  mode: PdfMode;
}
const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
/** Every displayed field is selected explicitly. Never enumerate or stringify the input document. */
export function renderQuotationHtml(input: PdfInput, fontCss: string): string {
  const v = input.version;
  const accepted = input.mode !== 'ORIGINAL_QUOTE';
  const chinese = v.contact.preferred_locale === 'zh-CN';
  const label = (en: string, zh: string) => (chinese ? zh : en);
  const date = (value: Date | undefined) =>
    value
      ? new Intl.DateTimeFormat(chinese ? 'zh-CN' : 'en-GB', {
          timeZone: 'Asia/Dhaka',
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(value)
      : '—';
  return `<!doctype html><html lang="${chinese ? 'zh-CN' : 'en'}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:"><style>${fontCss}
    @page { size:A4; margin:16mm; } *{box-sizing:border-box} body{font-family:'Noto Sans SC Variable','Noto Sans SC',sans-serif;color:#182534;font-size:10px;line-height:1.6} h1{font-size:22px;margin:0;color:#153f53} h2{font-size:15px} small{color:#526674} table{width:100%;border-collapse:collapse;margin:12px 0} th,td{text-align:left;padding:7px;border-bottom:1px solid #d9e1e6;vertical-align:top;overflow-wrap:anywhere} th{background:#e9f0f3} tr{break-inside:avoid} thead{display:table-header-group} .money{text-align:right;white-space:nowrap} .summary{margin-left:auto;max-width:310px} .notice{padding:12px;background:#edf5f1;border-left:4px solid #26745c} .watermark{position:fixed;top:42%;left:0;right:0;text-align:center;transform:rotate(-24deg);font-size:32px;font-weight:800;color:rgba(20,90,70,.13);z-index:-1} .bank{border:1px solid #b8c9d3;padding:12px;break-inside:avoid} p{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body>
    ${accepted ? '<div class="watermark">ACCEPTED / PROFORMA INVOICE</div>' : ''}
    <h1>${escape(input.branding.name)}</h1><small>${escape(input.branding.address)} ${escape(input.branding.email)}</small>
    <h2>${accepted ? 'ACCEPTED / PROFORMA INVOICE' : label('QUOTATION', '报价单')}</h2>
    <p>${escape(input.quotation_number)} · v${v.version_number}\n${label('Issued', '签发时间')}: ${escape(date(v.issued_at))} · ${label('Valid until', '有效期至')}: ${escape(date(v.valid_until))}</p>
    ${accepted ? `<div class="notice"><strong>ACCEPTED / PROFORMA INVOICE</strong><br>${label('Accepted at', '接受时间')}: ${escape(date(v.accepted_at))} (Asia/Dhaka)<br>${label('Reservation deadline', '预留截止时间')}: ${escape(date(v.reservation_expires_at))}</div>` : ''}
    <p>${label('Buyer', '买方')}: ${escape(v.contact.full_name)}${v.contact.company_name ? ` · ${escape(v.contact.company_name)}` : ''}</p>
    <table><thead><tr><th>${label('Medicine / specifications', '药品 / 规格')}</th><th>${label('Quantity', '数量')}</th><th>${label('Availability', '供应情况')}</th><th class="money">${label('Unit price', '单价')}</th><th class="money">${label('Line total', '小计')}</th></tr></thead><tbody>${v.items.map((line) => `<tr><td><strong>${escape(line.brand_name)}</strong><br>${escape(line.generic_name)} · ${escape(line.strength)}<br>${escape(line.dosage_form)} · ${escape(line.pack_size)}${line.customer_facing_note ? `<br>${escape(line.customer_facing_note)}` : ''}</td><td>${line.quantity} ${escape(line.packaging_unit)}</td><td>${escape(line.availability_status)}</td><td class="money">${line.availability_status === 'AVAILABLE' ? escape(line.unit_quoted_price) : '—'}</td><td class="money">${line.availability_status === 'AVAILABLE' ? escape(line.total_line_price) : '—'}</td></tr>`).join('')}</tbody></table>
    <table class="summary"><tr><td>${label('Subtotal', '商品小计')}</td><td class="money">${escape(v.subtotal_amount)}</td></tr><tr><td>${label('Freight', '运费')}</td><td class="money">${escape(v.freight_cost)}</td></tr><tr><td>${label('Insurance', '保险费')}</td><td class="money">${escape(v.insurance_cost)}</td></tr><tr><th>${label('Grand total', '总金额')} (${escape(v.billing_currency)})</th><th class="money">${escape(v.total_amount)}</th></tr></table>
    <p>${label('Shipping', '运输')}: ${escape(v.shipping_terms.incoterm ?? v.shipping_terms.method)} · ${escape(v.shipping_terms.named_place)}${v.shipping_terms.cold_chain_required ? ` · ${label('Cold chain', '冷链')} ${escape(v.shipping_terms.temperature_range)}` : ''}</p>
    <div class="bank"><h2>${label('Official bank wire (TT) instructions', '官方银行电汇付款信息')}</h2><p>${escape(input.wire_details.beneficiary_name)}\n${escape(input.wire_details.bank_name)}\n${escape(input.wire_details.bank_address)}\n${label('Account', '账号')}: ${escape(input.wire_details.account_number)}\nSWIFT: ${escape(input.wire_details.swift_code)}\n${escape(input.wire_details.instructions)}</p></div>
    <small>${label('Unavailable lines are excluded from the payable total. Times shown in Asia/Dhaka.', '无法供应的项目不计入应付总额。时间为孟加拉国达卡时间。')}</small></body></html>`;
}
