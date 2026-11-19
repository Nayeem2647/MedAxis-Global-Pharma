/**
 * Canonical Release 1 enums and limits.
 * Source of truth: Database-Schema.md (Section 2), PRD.md, API-Spec.md.
 */

export const API_VERSION = 'v1' as const;
export const API_BASE_PATH = `/${API_VERSION}` as const;
export const SERVICE_NAME = 'medaxis-global-pharma-api' as const;

export const RFQ_STATUS = Object.freeze({
  SUBMITTED: 'SUBMITTED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  NEED_CLARIFICATION: 'NEED_CLARIFICATION',
  QUOTED: 'QUOTED',
  CONVERTED: 'CONVERTED',
  CLOSED: 'CLOSED',
  CANCELLED: 'CANCELLED',
} as const);
export type RfqStatus = (typeof RFQ_STATUS)[keyof typeof RFQ_STATUS];

export const RFQ_CLOSE_REASON = Object.freeze({
  UNABLE_TO_SUPPLY: 'UNABLE_TO_SUPPLY',
} as const);
export type RfqCloseReason = (typeof RFQ_CLOSE_REASON)[keyof typeof RFQ_CLOSE_REASON];

export const RFQ_INQUIRY_TYPE = Object.freeze({
  QUICK_QUOTE: 'QUICK_QUOTE',
  CART_RFQ: 'CART_RFQ',
} as const);
export type RfqInquiryType = (typeof RFQ_INQUIRY_TYPE)[keyof typeof RFQ_INQUIRY_TYPE];

export const ITEM_AVAILABILITY_STATUS = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  UNAVAILABLE: 'UNAVAILABLE',
  SOURCING: 'SOURCING',
} as const);
export type ItemAvailabilityStatus = (typeof ITEM_AVAILABILITY_STATUS)[keyof typeof ITEM_AVAILABILITY_STATUS];

export const QUOTATION_VERSION_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  ACCEPTED: 'ACCEPTED',
  PAYMENT_RECEIVED: 'PAYMENT_RECEIVED',
  DISPATCHED: 'DISPATCHED',
  DELIVERED: 'DELIVERED',
  DECLINED: 'DECLINED',
  SUPERSEDED: 'SUPERSEDED',
  VALIDITY_EXPIRED: 'VALIDITY_EXPIRED',
  PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
} as const);
export type QuotationVersionStatus = (typeof QUOTATION_VERSION_STATUS)[keyof typeof QUOTATION_VERSION_STATUS];

export const QUOTATION_OVERALL_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  DECLINED: 'DECLINED',
  EXPIRED: 'EXPIRED',
} as const);
export type QuotationOverallStatus = (typeof QUOTATION_OVERALL_STATUS)[keyof typeof QUOTATION_OVERALL_STATUS];

export const RESERVATION_STATUS = Object.freeze({
  NONE: 'NONE',
  ACTIVE: 'ACTIVE',
  CONSUMED: 'CONSUMED',
  RELEASED: 'RELEASED',
} as const);
export type ReservationStatus = (typeof RESERVATION_STATUS)[keyof typeof RESERVATION_STATUS];

export const PRODUCT_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const);
export type ProductStatus = (typeof PRODUCT_STATUS)[keyof typeof PRODUCT_STATUS];

export const CUSTOMER_TYPE = Object.freeze({
  B2B_WHOLESALE: 'B2B_WHOLESALE',
  B2C_PATIENT: 'B2C_PATIENT',
} as const);
export type CustomerType = (typeof CUSTOMER_TYPE)[keyof typeof CUSTOMER_TYPE];

export const CURRENCIES = Object.freeze(['USD', 'EUR', 'CNY', 'BDT'] as const);
export type Currency = (typeof CURRENCIES)[number];

export const FX_CURRENCIES = Object.freeze(['USD', 'CNY', 'EUR'] as const);
export type FxCurrency = (typeof FX_CURRENCIES)[number];

export const LOCALES = Object.freeze(['en', 'zh-CN'] as const);
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const PRESCRIPTION_ALLOWED_MIME_TYPES = Object.freeze(['image/jpeg', 'image/png', 'application/pdf'] as const);
export const PRESCRIPTION_MAX_BYTES = 5_242_880; // 5 MiB

export const MAX_ITEMS_PER_RFQ = 100;
export const RESERVATION_CALENDAR_DAYS = 5;
export const BUSINESS_TIMEZONE = 'Asia/Dhaka';
export const DEFAULT_QUOTE_VALIDITY_DAYS = 7;

export const ADMIN_SESSION_COOKIE = 'medaxis_admin_session';
export const ADMIN_SESSION_IDLE_MINUTES = 30;
export const ADMIN_SESSION_IDLE_MS = ADMIN_SESSION_IDLE_MINUTES * 60 * 1000;
export const ADMIN_MAX_FAILED_ATTEMPTS = 5;
export const ADMIN_LOCKOUT_MINUTES = 15;

export const LOCALE_COOKIE = 'medaxis_locale';

export const ERROR_CODES = Object.freeze({
  TRANSLATION_NOT_CONFIGURED: 'TRANSLATION_NOT_CONFIGURED',
  TRANSLATION_UNAVAILABLE: 'TRANSLATION_UNAVAILABLE',
  TRANSLATION_QUOTA_EXCEEDED: 'TRANSLATION_QUOTA_EXCEEDED',
  MALFORMED_JSON: 'MALFORMED_JSON',
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_PRESCRIPTION_FILE: 'INVALID_PRESCRIPTION_FILE',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  ACCESS_DENIED: 'ACCESS_DENIED',
  TURNSTILE_VERIFICATION_FAILED: 'TURNSTILE_VERIFICATION_FAILED',
  QUOTATION_TOKEN_EXPIRED: 'QUOTATION_TOKEN_EXPIRED',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  API_VERSION_NOT_SUPPORTED: 'API_VERSION_NOT_SUPPORTED',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  IDEMPOTENCY_KEY_CONFLICT: 'IDEMPOTENCY_KEY_CONFLICT',
  QUOTATION_VERSION_CONFLICT: 'QUOTATION_VERSION_CONFLICT',
  RESOURCE_STATE_CONFLICT: 'RESOURCE_STATE_CONFLICT',
  API_VERSION_RETIRED: 'API_VERSION_RETIRED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  MANUFACTURER_LOGO_UPLOAD_FAILED: 'MANUFACTURER_LOGO_UPLOAD_FAILED',
  GENERIC_IMAGE_UPLOAD_FAILED: 'GENERIC_IMAGE_UPLOAD_FAILED',
  CATEGORY_IMAGE_UPLOAD_FAILED: 'CATEGORY_IMAGE_UPLOAD_FAILED',
  CATALOG_SLUG_CONFLICT: 'CATALOG_SLUG_CONFLICT',
} as const);
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface RoutePattern {
  readonly method: string;
  readonly pattern: RegExp;
}

export const MULTIPART_ROUTES: readonly RoutePattern[] = Object.freeze([
  Object.freeze({ method: 'POST', pattern: /^\/v1\/public\/prescriptions\/upload\/?$/ }),
  Object.freeze({ method: 'POST', pattern: /^\/v1\/admin\/catalog\/import-csv\/?$/ }),
  Object.freeze({ method: 'POST', pattern: /^\/v1\/admin\/catalog\/videos\/?$/ }),
  Object.freeze({ method: 'POST', pattern: /^\/v1\/admin\/catalog\/images\/?$/ }),
]);

export const NON_JSON_RESPONSE_ROUTES: readonly RoutePattern[] = Object.freeze([
  Object.freeze({ method: 'GET', pattern: /^\/v1\/public\/quotation\/pdf\/[^/]+\/?$/ }),
  Object.freeze({ method: 'GET', pattern: /^\/v1\/public\/media\/(?:products|avatars)\/.+$/ }),
  Object.freeze({ method: 'GET', pattern: /^\/v1\/admin\/prescriptions\/[^/]+\/stream\/?$/ }),
  Object.freeze({ method: 'GET', pattern: /^\/v1\/admin\/stream\/?$/ }),
]);

export const PRIVATE_QUOTATION_PATH_PREFIX = '/v1/public/quotation/';
