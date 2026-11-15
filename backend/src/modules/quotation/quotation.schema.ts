import { randomUUID } from 'node:crypto';
import { Schema, model, type Types } from 'mongoose';
import { installPersistenceGuards } from '../../shared/persistence/guards.js';

export interface IQuotation {
  _id: string;
  quotation_number: string;
  rfq_id: string;
  customer_id: string;
  current_version: number;
  current_version_id: string;
  overall_status: 'ACTIVE' | 'COMPLETED' | 'DECLINED' | 'EXPIRED';
  created_at: Date;
  updated_at: Date;
}

export const QuotationSchema = new Schema<IQuotation>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    quotation_number: { type: String, required: true, trim: true, maxlength: 200 },
    rfq_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    customer_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    current_version: { type: Number, required: true, validate: Number.isSafeInteger, min: 1, default: 1 },
    current_version_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    overall_status: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['ACTIVE', 'COMPLETED', 'DECLINED', 'EXPIRED'],
      default: 'ACTIVE',
    },
  },
  {
    collection: 'quotations',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
QuotationSchema.index({ quotation_number: 1 }, { unique: true });
QuotationSchema.index({ customer_id: 1 }, {});
QuotationSchema.index({ rfq_id: 1 }, { unique: true, partialFilterExpression: { overall_status: 'ACTIVE' } });
installPersistenceGuards(QuotationSchema, 'quotations');
export const QuotationModel = model<IQuotation>('Quotation', QuotationSchema, 'quotations');

export interface IQuotationVersion {
  _id: string;
  quotation_id: string;
  version_number: number;
  status:
    | 'DRAFT'
    | 'SENT'
    | 'ACCEPTED'
    | 'PAYMENT_RECEIVED'
    | 'DISPATCHED'
    | 'DELIVERED'
    | 'DECLINED'
    | 'VALIDITY_EXPIRED'
    | 'SUPERSEDED'
    | 'PAYMENT_EXPIRED';
  contact_snapshot: {
    full_name: string;
    customer_type: 'B2B_WHOLESALE' | 'B2C_PATIENT';
    company_name?: string;
    email?: string;
    whatsapp_number?: string;
    wechat_id?: string;
    preferred_locale: 'en' | 'zh-CN';
  };
  items: Array<{
    _id: string;
    rfq_item_id: string;
    product_id?: string;
    manufacturer_id: string;
    brand_name_snapshot: string;
    generic_name_snapshot: string;
    strength_snapshot: string;
    dosage_form_snapshot: string;
    pack_size_snapshot: string;
    packaging_unit: string;
    quantity: number;
    availability_status: 'AVAILABLE' | 'UNAVAILABLE' | 'SOURCING';
    customer_facing_note?: string;
    unit_quoted_price?: Types.Decimal128;
    total_line_price?: Types.Decimal128;
  }>;
  billing_currency: 'USD' | 'CNY' | 'EUR' | 'BDT';
  subtotal_amount: Types.Decimal128;
  freight_cost: Types.Decimal128;
  insurance_cost: Types.Decimal128;
  total_amount: Types.Decimal128;
  shipping_terms: {
    method: 'INCOTERM' | 'EXPRESS_COURIER';
    incoterm?: 'FCA' | 'CIP' | 'DAP' | 'CPT' | 'FOB' | 'CIF';
    named_place: string;
    cold_chain_required: boolean;
    temperature_range?: string;
  };
  payment_terms: string;
  bank_details_snapshot?: Record<string, unknown>;
  fx_snapshot?: {
    mode: 'LIVE' | 'MANUAL_FIXED';
    modes?: { USD: 'LIVE' | 'MANUAL_FIXED'; CNY: 'LIVE' | 'MANUAL_FIXED'; EUR: 'LIVE' | 'MANUAL_FIXED' };
    fetched_at?: { USD: Date; CNY: Date; EUR: Date };
    stale_rates_used?: boolean;
    captured_at: Date;
    rates_to_bdt: { USD: Types.Decimal128; CNY: Types.Decimal128; EUR: Types.Decimal128 };
  };
  issued_at?: Date;
  valid_until?: Date;
  magic_link_token_hash?: string;
  accepted_at?: Date;
  acceptance_evidence?: { accepted_at: Date; client_ip: string; user_agent: string; terms_accepted: boolean };
  reservation_expires_at?: Date;
  reservation_status: 'NONE' | 'ACTIVE' | 'CONSUMED' | 'RELEASED';
  payment?: {
    reference: string;
    amount: Types.Decimal128;
    currency: 'USD' | 'CNY' | 'EUR' | 'BDT';
    received_at: Date;
    recorded_by: string;
  };
  shipment?: { courier_name: string; awb_number: string; dispatched_at: Date; estimated_delivery?: Date };
  delivered_at?: Date;
  decline_reason?: 'PRICE' | 'LEAD_TIME' | 'SPECIFICATION' | 'OTHER';
  decline_notes?: string;
  revision_request?: Record<string, unknown>;
  pdf?: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  locked_fx_rates?: IQuotationVersion['fx_snapshot'];
}

export const QuotationVersionSchema = new Schema<IQuotationVersion>(
  {
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    quotation_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    version_number: { type: Number, required: true, validate: Number.isSafeInteger, min: 1 },
    status: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: [
        'DRAFT',
        'SENT',
        'ACCEPTED',
        'PAYMENT_RECEIVED',
        'DISPATCHED',
        'DELIVERED',
        'DECLINED',
        'VALIDITY_EXPIRED',
        'SUPERSEDED',
        'PAYMENT_EXPIRED',
      ],
      default: 'DRAFT',
    },
    contact_snapshot: {
      type: new Schema(
        {
          full_name: { type: String, required: true, trim: true, maxlength: 200 },
          customer_type: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
            enum: ['B2B_WHOLESALE', 'B2C_PATIENT'],
          },
          company_name: { type: String, required: false, trim: true, maxlength: 200 },
          email: {
            type: String,
            required: false,
            trim: true,
            maxlength: 200,
            lowercase: true,
            match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
            set: (value: string | undefined) => value?.trim().toLowerCase() || undefined,
          },
          whatsapp_number: { type: String, required: false, trim: true, maxlength: 50 },
          wechat_id: { type: String, required: false, trim: true, maxlength: 100 },
          preferred_locale: { type: String, required: true, trim: true, maxlength: 200, enum: ['en', 'zh-CN'] },
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    items: {
      type: [
        {
          type: new Schema(
            {
              _id: {
                type: String,
                required: true,
                default: () => randomUUID(),
                trim: true,
                maxlength: 200,
                match: new RegExp(
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                ),
              },
              rfq_item_id: {
                type: String,
                required: true,
                trim: true,
                maxlength: 200,
                match: new RegExp(
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                ),
              },
              product_id: {
                type: String,
                required: false,
                trim: true,
                maxlength: 200,
                match: new RegExp(
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                ),
              },
              manufacturer_id: {
                type: String,
                required: true,
                trim: true,
                maxlength: 200,
                match: new RegExp(
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                ),
              },
              brand_name_snapshot: { type: String, required: true, trim: true, maxlength: 200 },
              generic_name_snapshot: { type: String, required: true, trim: true, maxlength: 200 },
              strength_snapshot: { type: String, required: true, trim: true, maxlength: 200 },
              dosage_form_snapshot: { type: String, required: true, trim: true, maxlength: 200 },
              pack_size_snapshot: { type: String, required: true, trim: true, maxlength: 200 },
              packaging_unit: { type: String, required: true, trim: true, maxlength: 40 },
              quantity: { type: Number, required: true, validate: Number.isSafeInteger, min: 1 },
              availability_status: {
                type: String,
                required: true,
                trim: true,
                maxlength: 200,
                enum: ['AVAILABLE', 'UNAVAILABLE', 'SOURCING'],
              },
              customer_facing_note: { type: String, required: false, trim: true, maxlength: 2000 },
              unit_quoted_price: {
                type: Schema.Types.Decimal128,
                required: false,
                validate: {
                  validator: (v: { toString(): string }) =>
                    /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
                  message: 'Decimal must be finite',
                },
              },
              total_line_price: {
                type: Schema.Types.Decimal128,
                required: false,
                validate: {
                  validator: (v: { toString(): string }) =>
                    /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
                  message: 'Decimal must be finite',
                },
              },
            },
            { _id: false, strict: 'throw' },
          ),
          required: true,
        },
      ],
      required: true,
      default: undefined,
      validate: {
        validator: (v: unknown[]) => v.length >= 1 && v.length <= 100,
        message: 'Array length outside contract bounds',
      },
    },
    billing_currency: { type: String, required: true, trim: true, maxlength: 200, enum: ['USD', 'CNY', 'EUR', 'BDT'] },
    subtotal_amount: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    freight_cost: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    insurance_cost: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    total_amount: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    shipping_terms: {
      type: new Schema(
        {
          method: { type: String, required: true, trim: true, maxlength: 200, enum: ['INCOTERM', 'EXPRESS_COURIER'] },
          incoterm: {
            type: String,
            required: false,
            trim: true,
            maxlength: 200,
            enum: ['FCA', 'CIP', 'DAP', 'CPT', 'FOB', 'CIF'],
          },
          named_place: { type: String, required: true, trim: true, maxlength: 200 },
          cold_chain_required: { type: Boolean, required: true, default: false },
          temperature_range: { type: String, required: false, trim: true, maxlength: 200 },
        },
        { _id: false, strict: 'throw' },
      ),
      required: true,
    },
    payment_terms: { type: String, required: true, trim: true, maxlength: 200 },
    bank_details_snapshot: { type: Schema.Types.Mixed, required: false },
    fx_snapshot: {
      type: new Schema(
        {
          modes: {
            type: new Schema(
              {
                USD: { type: String, enum: ['LIVE', 'MANUAL_FIXED'], required: true },
                CNY: { type: String, enum: ['LIVE', 'MANUAL_FIXED'], required: true },
                EUR: { type: String, enum: ['LIVE', 'MANUAL_FIXED'], required: true },
              },
              { _id: false, strict: 'throw' },
            ),
          },
          fetched_at: {
            type: new Schema(
              {
                USD: { type: Date, required: true },
                CNY: { type: Date, required: true },
                EUR: { type: Date, required: true },
              },
              { _id: false, strict: 'throw' },
            ),
          },
          stale_rates_used: { type: Boolean },
          mode: { type: String, required: true, trim: true, maxlength: 200, enum: ['LIVE', 'MANUAL_FIXED'] },
          captured_at: { type: Date, required: true },
          rates_to_bdt: {
            type: new Schema(
              {
                USD: {
                  type: Schema.Types.Decimal128,
                  required: true,
                  validate: {
                    validator: (v: { toString(): string }) =>
                      /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
                    message: 'Decimal must be finite',
                  },
                },
                CNY: {
                  type: Schema.Types.Decimal128,
                  required: true,
                  validate: {
                    validator: (v: { toString(): string }) =>
                      /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
                    message: 'Decimal must be finite',
                  },
                },
                EUR: {
                  type: Schema.Types.Decimal128,
                  required: true,
                  validate: {
                    validator: (v: { toString(): string }) =>
                      /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
                    message: 'Decimal must be finite',
                  },
                },
              },
              { _id: false, strict: 'throw' },
            ),
            required: true,
          },
        },
        { _id: false, strict: 'throw' },
      ),
      required: false,
      alias: 'locked_fx_rates',
    },
    issued_at: { type: Date, required: false },
    valid_until: { type: Date, required: false },
    magic_link_token_hash: {
      type: String,
      required: false,
      trim: true,
      maxlength: 64,
      match: new RegExp('^[a-fA-F0-9]{64}$'),
      select: false,
    },
    accepted_at: { type: Date, required: false },
    acceptance_evidence: {
      type: new Schema(
        {
          accepted_at: { type: Date, required: true },
          client_ip: { type: String, required: true, trim: true, maxlength: 200 },
          user_agent: { type: String, required: true, trim: true, maxlength: 2000 },
          terms_accepted: { type: Boolean, required: true },
        },
        { _id: false, strict: 'throw' },
      ),
      required: false,
    },
    reservation_expires_at: { type: Date, required: false },
    reservation_status: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      enum: ['NONE', 'ACTIVE', 'CONSUMED', 'RELEASED'],
      default: 'NONE',
    },
    payment: {
      type: new Schema(
        {
          reference: { type: String, required: true, trim: true, maxlength: 200 },
          amount: {
            type: Schema.Types.Decimal128,
            required: true,
            validate: {
              validator: (v: { toString(): string }) =>
                /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
              message: 'Decimal must be finite',
            },
          },
          currency: { type: String, required: true, trim: true, maxlength: 200, enum: ['USD', 'CNY', 'EUR', 'BDT'] },
          received_at: { type: Date, required: true },
          recorded_by: {
            type: String,
            required: true,
            trim: true,
            maxlength: 200,
            match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
          },
        },
        { _id: false, strict: 'throw' },
      ),
      required: false,
    },
    shipment: {
      type: new Schema(
        {
          courier_name: { type: String, required: true, trim: true, maxlength: 200 },
          awb_number: { type: String, required: true, trim: true, maxlength: 200 },
          dispatched_at: { type: Date, required: true },
          estimated_delivery: { type: Date, required: false },
        },
        { _id: false, strict: 'throw' },
      ),
      required: false,
    },
    delivered_at: { type: Date, required: false },
    decline_reason: {
      type: String,
      required: false,
      trim: true,
      maxlength: 200,
      enum: ['PRICE', 'LEAD_TIME', 'SPECIFICATION', 'OTHER'],
    },
    decline_notes: { type: String, required: false, trim: true, maxlength: 2000 },
    revision_request: { type: Schema.Types.Mixed, required: false },
    pdf: { type: Schema.Types.Mixed, required: false },
  },
  {
    collection: 'quotation_versions',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
QuotationVersionSchema.index({ quotation_id: 1, version_number: 1 }, { unique: true });
QuotationVersionSchema.index(
  { magic_link_token_hash: 1 },
  { unique: true, partialFilterExpression: { magic_link_token_hash: { $type: 'string' } } },
);
QuotationVersionSchema.index({ status: 1, valid_until: 1 }, {});
QuotationVersionSchema.index({ status: 1, reservation_expires_at: 1 }, {});
QuotationVersionSchema.index({ status: 1, accepted_at: 1 }, {});
installPersistenceGuards(QuotationVersionSchema, 'quotation_versions');
export const QuotationVersionModel = model<IQuotationVersion>(
  'QuotationVersion',
  QuotationVersionSchema,
  'quotation_versions',
);

export interface IQuotationInternalCost {
  _id: string;
  quotation_version_id: string;
  items: Array<{
    rfq_item_id: string;
    manufacturer_id: string;
    procurement_unit_cost_bdt: Types.Decimal128;
    quantity: number;
    markup_percent: Types.Decimal128;
  }>;
  procurement_cost_bdt: Types.Decimal128;
  target_markup_percent: Types.Decimal128;
  calculated_base_bdt: Types.Decimal128;
  gross_margin_bdt?: Types.Decimal128;
  effective_gross_margin_percent?: Types.Decimal128;
  internal_procurement_notes?: string;
  created_at: Date;
  updated_at: Date;
}

export const QuotationInternalCostSchema = new Schema<IQuotationInternalCost>(
  {
    gross_margin_bdt: {
      type: Schema.Types.Decimal128,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    _id: {
      type: String,
      required: true,
      default: () => randomUUID(),
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    quotation_version_id: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
      match: new RegExp('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'),
    },
    items: {
      type: [
        {
          type: new Schema(
            {
              rfq_item_id: {
                type: String,
                required: true,
                trim: true,
                maxlength: 200,
                match: new RegExp(
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                ),
              },
              manufacturer_id: {
                type: String,
                required: true,
                trim: true,
                maxlength: 200,
                match: new RegExp(
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
                ),
              },
              procurement_unit_cost_bdt: {
                type: Schema.Types.Decimal128,
                required: true,
                validate: {
                  validator: (v: { toString(): string }) =>
                    /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
                  message: 'Decimal must be finite',
                },
              },
              quantity: { type: Number, required: true, validate: Number.isSafeInteger, min: 1 },
              markup_percent: {
                type: Schema.Types.Decimal128,
                required: true,
                validate: {
                  validator: (v: { toString(): string }) =>
                    /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
                  message: 'Decimal must be finite',
                },
              },
            },
            { _id: false, strict: 'throw' },
          ),
          required: true,
        },
      ],
      required: true,
      default: undefined,
      validate: {
        validator: (v: unknown[]) => v.length >= 1 && v.length <= 100,
        message: 'Array length outside contract bounds',
      },
    },
    procurement_cost_bdt: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    target_markup_percent: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    calculated_base_bdt: {
      type: Schema.Types.Decimal128,
      required: true,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    effective_gross_margin_percent: {
      type: Schema.Types.Decimal128,
      required: false,
      validate: {
        validator: (v: { toString(): string }) => /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(v.toString()),
        message: 'Decimal must be finite',
      },
    },
    internal_procurement_notes: { type: String, required: false, trim: true, maxlength: 5000, select: false },
  },
  {
    collection: 'quotation_internal_costs',
    strict: 'throw',
    versionKey: false,
    autoIndex: false,
    autoCreate: false,
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  },
);
QuotationInternalCostSchema.index({ quotation_version_id: 1 }, { unique: true });
installPersistenceGuards(QuotationInternalCostSchema, 'quotation_internal_costs');
export const QuotationInternalCostModel = model<IQuotationInternalCost>(
  'QuotationInternalCost',
  QuotationInternalCostSchema,
  'quotation_internal_costs',
);
