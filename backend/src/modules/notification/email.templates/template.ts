import type { CustomerQuotationDto } from '../../quotation/quotation.dto.js';
import type { EmailMessage } from '../notification.transport.js';

export type TemplateId =
  | 'rfq-confirmation'
  | 'quotation-sent'
  | 'accepted'
  | 'expiry-reminder'
  | 'dispatch'
  | 'delivered'
  | 'clarification-request'
  | 'unable-to-supply'
  | 'revision-request'
  | 'admin-new-rfq-alert'
  | 'admin-accepted-alert'
  | 'payment-received'
  | 'reservation-expired'
  | 'quotation-declined'
  | 'refresh-request'
  | 'operational-alert';
export interface EmailContext {
  locale: 'en' | 'zh-CN';
  reference: string;
  buyerName?: string;
  quotation?: CustomerQuotationDto;
  link?: string;
  pdfLink?: string;
  body?: string;
  replyTo?: string;
  threadId?: string;
  reminderKind?: 'QUOTATION_24H' | 'RESERVATION_DAY3';
  alertCode?: string;
  security?: {
    occurred_at: string;
    ip_address: string;
    country: string | null;
    city: string | null;
    user_agent: string;
    new_ip?: boolean;
    foreign_ip?: boolean;
  };
}
const subjects: Record<TemplateId, [string, string]> = {
  'rfq-confirmation': ['We received your inquiry', '我们已收到您的询价'],
  'quotation-sent': ['Your quotation is ready', '您的报价单已准备就绪'],
  accepted: ['Quotation accepted — bank wire instructions', '报价已接受 — 银行电汇付款信息'],
  'expiry-reminder': ['Quotation / payment reminder', '报价有效期 / 付款提醒'],
  dispatch: ['Your order has been dispatched', '您的订单已发货'],
  delivered: ['Delivery confirmed', '订单已送达'],
  'clarification-request': ['More information is needed', '请补充询价信息'],
  'unable-to-supply': ['Unable to supply your inquiry', '本次询价暂时无法供货'],
  'revision-request': ['Buyer requested a revision', '买方请求修改报价'],
  'admin-new-rfq-alert': ['New RFQ — review required', '新询价 — 请及时处理'],
  'admin-accepted-alert': ['Quotation accepted — action required', '报价已接受 — 请跟进'],
  'payment-received': ['Bank payment confirmed', '银行付款已确认'],
  'reservation-expired': ['Payment window and stock reservation expired', '付款期限和货品预留已到期'],
  'quotation-declined': ['Quotation declined', '报价已拒绝'],
  'refresh-request': ['Updated quotation requested', '请求更新报价'],
  'operational-alert': ['High priority platform alert', '平台高优先级提醒'],
};
export const escapeEmail = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
/** Typed HTML builder: no object enumeration and no internal-cost inputs. */
export function template(id: TemplateId) {
  return (context: EmailContext): EmailMessage => {
    const zh = context.locale === 'zh-CN';
    const pick = (en: string, cn: string) => (zh ? cn : en);
    const quote = context.quotation;
    const title = subjects[id][zh ? 1 : 0];
    const paragraphs: string[] = [title, `${pick('Reference', '编号')}: ${context.reference}`];
    if (context.buyerName) paragraphs.push(`${pick('Buyer', '买方')}: ${context.buyerName}`);
    if (id === 'rfq-confirmation')
      paragraphs.push(
        pick(
          'Thank you. Our team will review your requirements and contact you.',
          '感谢您的询价。我们的团队将审核您的需求并与您联系。',
        ),
      );
    if (id === 'admin-new-rfq-alert')
      paragraphs.push(pick('A new inquiry is waiting in the admin dashboard.', '管理后台有新的询价等待处理。'));
    if (id === 'quotation-sent' && quote)
      paragraphs.push(
        `${pick('Quotation / PDF summary', '报价单 / PDF 摘要')}: v${quote.version_number} · ${quote.billing_currency} ${quote.total_amount}`,
        `${pick('Valid until', '有效期至')}: ${quote.valid_until?.toISOString()}`,
      );
    if ((id === 'accepted' || id === 'admin-accepted-alert') && quote)
      paragraphs.push(
        pick(
          'Acceptance is confirmed. Stock is reserved for 5 calendar days.',
          '报价接受已确认。货品保留期限为五个日历日。',
        ),
        `${pick('Reservation deadline', '预留截止时间')}: ${quote.reservation_expires_at?.toISOString()}`,
      );
    if (
      (id === 'accepted' || (id === 'expiry-reminder' && context.reminderKind === 'RESERVATION_DAY3')) &&
      quote?.bank_details
    ) {
      const bank = quote.bank_details;
      paragraphs.push(
        pick('Official bank wire (TT) instructions', '官方银行电汇付款信息'),
        `${bank.beneficiary_name}\n${bank.bank_name}\n${bank.bank_address ?? ''}\n${bank.account_number}\nSWIFT: ${bank.swift_code}\n${bank.instructions}`,
      );
    }
    if (id === 'expiry-reminder')
      paragraphs.push(
        context.reminderKind === 'RESERVATION_DAY3'
          ? pick(
              'Your reservation is at least 3 days old. Please arrange payment before the reservation deadline.',
              '您的货品已预留至少三天。请在预留截止时间前安排付款。',
            )
          : pick(
              'Your quotation expires within 24 hours. Please review it before its validity ends.',
              '您的报价单将在二十四小时内到期，请在有效期内查阅。',
            ),
        `${pick('Deadline', '截止时间')}: ${(context.reminderKind === 'RESERVATION_DAY3' ? quote?.reservation_expires_at : quote?.valid_until)?.toISOString()}`,
      );
    if (id === 'dispatch' && quote?.shipment)
      paragraphs.push(
        `${pick('Courier', '承运商')}: ${quote.shipment.courier_name}`,
        `${pick('AWB tracking number', '运单追踪号码')}: ${quote.shipment.awb_tracking_number}`,
      );
    if (id === 'delivered')
      paragraphs.push(
        pick(
          'Delivery has been confirmed. Thank you for choosing MedAxis Global Pharma.',
          '您的订单已确认送达。感谢您选择 MedAxis Global Pharma。',
        ),
      );
    if (context.body && ['clarification-request', 'unable-to-supply', 'revision-request'].includes(id))
      paragraphs.push(context.body);
    if (id === 'clarification-request')
      paragraphs.push(
        pick(
          'Reply to this email to keep your inquiry in the same thread.',
          '请回复此邮件，以便在同一询价对话中继续沟通。',
        ),
        ...(context.threadId ? [`${pick('Thread reference', '对话编号')}: ${context.threadId}`] : []),
      );
    if (id === 'operational-alert') paragraphs.push(context.alertCode ?? 'OPERATOR_REVIEW_REQUIRED');
    if (id === 'payment-received' && quote?.payment)
      paragraphs.push(
        `${pick('Payment reference', '付款参考编号')}: ${quote.payment.reference}`,
        `${quote.payment.currency} ${quote.payment.amount}`,
      );
    if (id === 'reservation-expired')
      paragraphs.push(
        pick(
          'The unpaid reservation deadline has passed and the logical allocation has been released. Please request an updated quotation before making payment.',
          '未付款的货品预留期限已过，预留已释放。付款前请申请更新报价。',
        ),
      );
    if (id === 'quotation-declined')
      paragraphs.push(
        pick(
          'The buyer declined this quotation. Review the recorded reason in the admin dashboard.',
          '买方已拒绝此报价，请在管理后台查看原因。',
        ),
      );
    if (id === 'refresh-request')
      paragraphs.push(
        pick(
          'The buyer requested a refreshed quotation. Review the inquiry in the admin dashboard.',
          '买方请求更新报价，请在管理后台查看询价。',
        ),
      );
    if (context.security)
      paragraphs.push(
        `${context.security.occurred_at}\nIP: ${context.security.ip_address}\n${context.security.country ?? ''} / ${context.security.city ?? ''}\n${context.security.user_agent}\n${pick('New / foreign IP', '新 IP / 境外 IP')}: ${context.security.new_ip ? 'YES' : 'NO'} / ${context.security.foreign_ip ? 'YES' : 'NO'}`,
      );
    const links: Array<[string, string]> = [];
    if (context.link) links.push([pick('View quotation', '查看报价单'), context.link]);
    if (context.pdfLink) links.push([pick('Download PDF', '下载 PDF'), context.pdfLink]);
    const text = [...paragraphs, ...links.map(([label, url]) => `${label}: ${url}`)].join('\n\n');
    return {
      subject: `${title}: ${context.reference}`.replace(/[\r\n]/g, ' '),
      locale: context.locale,
      text,
      replyTo: context.replyTo,
      html: `<!doctype html><html lang="${context.locale}"><head><meta charset="utf-8"></head><body style="font-family:Arial,'Noto Sans SC',sans-serif;color:#183342"><h1>MedAxis Global Pharma</h1>${paragraphs.map((line) => `<p style="white-space:pre-wrap">${escapeEmail(line)}</p>`).join('')}${links.map(([label, url]) => `<p><a href="${escapeEmail(url)}" style="background:#174d63;color:#fff;padding:12px;display:inline-block">${escapeEmail(label)}</a></p>`).join('')}</body></html>`,
    };
  };
}
