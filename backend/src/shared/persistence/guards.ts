import { type Schema, type Query, type Types } from 'mongoose';

const financialFields = [
  'quotation_id',
  'version_number',
  'contact_snapshot',
  'items',
  'billing_currency',
  'subtotal_amount',
  'freight_cost',
  'insurance_cost',
  'total_amount',
  'shipping_terms',
  'payment_terms',
  'bank_details_snapshot',
  'fx_snapshot',
  'locked_fx_rates',
  'issued_at',
  'valid_until',
];
const touches = (paths: string[], field: string): boolean =>
  paths.some((p) => p === field || p.startsWith(`${field}.`));

/** Enumerate both destinations and sources of operator updates (including $rename). */
function updatePaths(update: Record<string, unknown>): string[] {
  return Object.entries(update).flatMap(([key, value]) => {
    if (!key.startsWith('$')) return [key];
    if (!value || typeof value !== 'object') throw new Error('Unsupported update');
    return [...Object.keys(value), ...(key === '$rename' ? Object.values(value).map(String) : [])];
  });
}

export function installPersistenceGuards<T>(schema: Schema<T>, collection: string): void {
  // Embedded documents do not have independent version keys in the canonical
  // BSON contract. Inherit the root setting so Mongoose's transaction rollback
  // does not try to restore an undefined __v on strict embedded schemas.
  if (schema.options.versionKey === false) {
    const visited = new WeakSet<Schema>();
    const inherit = (parent: Schema) => {
      if (visited.has(parent)) return;
      visited.add(parent);
      for (const child of parent.childSchemas) {
        child.schema.set('versionKey', false);
        inherit(child.schema);
      }
    };
    inherit(schema);
  }
  schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function () {
    this.setOptions({ runValidators: true, context: 'query' });
  });

  if (collection === 'audit_logs') {
    const reject = (): never => {
      throw new Error('Audit logs are append-only');
    };
    schema.pre('save', function () {
      if (!this.isNew) reject();
    });
    schema.pre(
      [
        'updateOne',
        'updateMany',
        'findOneAndUpdate',
        'replaceOne',
        'findOneAndReplace',
        'deleteOne',
        'deleteMany',
        'findOneAndDelete',
      ],
      reject,
    );
    schema.pre('deleteOne', { document: true, query: false }, reject);
    schema.pre('bulkWrite', function (operations) {
      if (operations.some((op) => !('insertOne' in op))) reject();
    });
    return;
  }

  if (collection === 'customers' || collection === 'rfqs' || collection === 'quotation_versions') {
    schema.pre('validate', function () {
      const contact = collection === 'customers' ? this : this.get('contact_snapshot');
      if (contact && !contact.email && !contact.whatsapp_number && !contact.wechat_id)
        this.invalidate('email', 'At least one contact channel is required');
      if (contact?.customer_type === 'B2B_WHOLESALE' && !contact.company_name)
        this.invalidate('company_name', 'B2B requires a company name');
      if (collection === 'rfqs') {
        const items = this.get('items') as Array<{
          product_id?: string;
          is_uncatalogued: boolean;
          custom_medicine_name?: string;
        }>;
        for (const item of items ?? []) {
          if (item.is_uncatalogued ? !item.custom_medicine_name : !item.product_id)
            this.invalidate('items', 'Line requires product_id or custom medicine name');
        }
      }
    });
  }

  if (collection === 'exchange_rates') {
    schema.pre('validate', function () {
      if (this.get('_id') !== this.get('currency_code'))
        this.invalidate('currency_code', 'Currency code must equal _id');
      for (const field of ['live_rate_to_bdt', 'manual_rate_to_bdt']) {
        const rate = this.get(field) as Types.Decimal128 | undefined;
        if (
          rate &&
          (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(rate.toString()) ||
            /^0(?:\.0*)?(?:[eE].*)?$/.test(rate.toString()))
        )
          this.invalidate(field, 'Rate must be positive and finite');
      }
      if (this.get('mode') === 'MANUAL_FIXED' && !this.get('manual_rate_to_bdt'))
        this.invalidate('manual_rate_to_bdt', 'Manual mode requires a rate');
    });
  }

  if (collection === 'quotation_versions') {
    schema.pre('validate', function () {
      const items = this.get('items') as Array<{
        availability_status: string;
        unit_quoted_price?: Types.Decimal128;
        total_line_price?: Types.Decimal128;
        customer_facing_note?: string;
      }>;
      for (const item of items ?? []) {
        if (item.availability_status === 'AVAILABLE' && (!item.unit_quoted_price || !item.total_line_price))
          this.invalidate('items', 'Available lines require prices');
        if (
          item.availability_status === 'UNAVAILABLE' &&
          (item.unit_quoted_price || item.total_line_price || !item.customer_facing_note)
        )
          this.invalidate('items', 'Unavailable lines require a note and no payable prices');
      }
      if (
        this.get('status') !== 'DRAFT' &&
        (this.isNew || (this.isModified('status') && this.get('status') === 'SENT'))
      ) {
        if (
          !items?.some((i) => i.availability_status === 'AVAILABLE') ||
          items.some((i) => i.availability_status === 'SOURCING')
        )
          this.invalidate('items', 'Issued versions require available lines and no sourcing lines');
        for (const field of ['issued_at', 'valid_until', 'fx_snapshot', 'magic_link_token_hash'])
          if (!this.get(field)) this.invalidate(field, 'Required at issuance');
      }
      const shipping = this.get('shipping_terms');
      if (shipping?.method === 'INCOTERM' && !shipping.incoterm)
        this.invalidate('shipping_terms', 'Incoterm is required');
    });
  }

  const isVersion = collection === 'quotation_versions';
  const isCost = collection === 'quotation_internal_costs';
  if (!isVersion && !isCost && collection !== 'rfqs') return;

  // These paths cannot safely apply per-document state checks or preserve snapshots.
  schema.pre(['replaceOne', 'findOneAndReplace'], function () {
    throw new Error('Snapshot replacement is forbidden');
  });
  schema.pre('bulkWrite', function () {
    throw new Error('Use guarded document writes for snapshots');
  });
  if (isVersion || isCost) {
    schema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], function () {
      throw new Error('Financial records cannot be deleted');
    });
    schema.pre('deleteOne', { document: true, query: false }, function () {
      throw new Error('Financial records cannot be deleted');
    });
  }
  if (isCost)
    schema.pre('insertMany', function () {
      throw new Error('Use transactional save for internal costs');
    });

  schema.pre('save', async function () {
    if (this.isNew && !isCost) return;
    const session = this.$session();
    if (isCost) {
      if (!session?.inTransaction()) throw new Error('Cost writes require a transaction to serialize against issuance');
      const versionId = this.get('quotation_version_id');
      const parent = await this.db
        .model('QuotationVersion')
        .updateOne({ _id: versionId, status: 'DRAFT' }, { $set: { updated_at: new Date() } }, { session });
      if (parent.matchedCount !== 1) throw new Error('Internal costs require a DRAFT quotation version');
      if (!this.isNew && this.isModified('quotation_version_id')) throw new Error('Cost parent is immutable');
      return;
    }
    const previous = (await this.$model().findById(this.get('_id')).session(session).lean()) as Record<
      string,
      unknown
    > | null;
    if (!previous) throw new Error('Snapshot no longer exists');
    const modified = this.modifiedPaths();
    if (collection === 'rfqs' && touches(modified, 'contact_snapshot'))
      throw new Error('RFQ contact snapshot is immutable');
    if (isVersion) {
      if (previous.status !== 'DRAFT' && this.get('status') === 'DRAFT')
        throw new Error('Issued versions cannot return to DRAFT');
      if (previous.fx_snapshot && touches(modified, 'fx_snapshot')) throw new Error('Locked FX rates are immutable');
      if (previous.status !== 'DRAFT' && financialFields.some((f) => touches(modified, f)))
        throw new Error('Issued financial fields are immutable');
      // Mongoose includes this predicate in the eventual write, closing the issue/edit race.
      if (financialFields.some((f) => touches(modified, f)))
        this.$where = {
          ...this.$where,
          status: 'DRAFT',
          ...(touches(modified, 'fx_snapshot') ? { fx_snapshot: { $exists: false } } : {}),
        };
    }
  });

  schema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], async function () {
    const query = this as Query<unknown, unknown>;
    const update = query.getUpdate();
    if (!update || Array.isArray(update)) throw new Error('Update pipelines are forbidden for snapshots');
    const paths = updatePaths(update as Record<string, unknown>);
    if (collection === 'rfqs' && touches(paths, 'contact_snapshot'))
      throw new Error('RFQ contact snapshot is immutable');
    if (!isVersion && !isCost) return;
    if ((query as unknown as { op: string }).op === 'updateMany' || query.getOptions().upsert)
      throw new Error('Use individual snapshot writes without upsert');
    const existing = (await query.model
      .findOne(query.getFilter())
      .session(query.getOptions().session ?? null)
      .lean()) as Record<string, unknown> | null;
    if (!existing) return;
    // Bind the checked record even when the caller supplied a broad filter.
    query.where({ _id: existing._id });
    if (isCost) {
      const session = query.getOptions().session;
      if (!session?.inTransaction()) throw new Error('Cost writes require a transaction to serialize against issuance');
      if (touches(paths, 'quotation_version_id')) throw new Error('Cost parent is immutable');
      const parent = await query.model.db
        .model('QuotationVersion')
        .updateOne(
          { _id: existing.quotation_version_id, status: 'DRAFT' },
          { $set: { updated_at: new Date() } },
          { session },
        );
      if (parent.matchedCount !== 1) throw new Error('Issued internal costs are immutable');
    } else {
      const raw = update as Record<string, unknown>;
      const set = raw.$set as Record<string, unknown> | undefined;
      if (raw.$rename && touches(updatePaths({ $rename: raw.$rename }), 'status'))
        throw new Error('Status cannot be renamed');
      if (existing.status !== 'DRAFT' && (raw.status === 'DRAFT' || set?.status === 'DRAFT'))
        throw new Error('Issued versions cannot return to DRAFT');
      if (touches(paths, 'locked_fx_rates')) throw new Error('Use canonical fx_snapshot field');
      if (existing.fx_snapshot && touches(paths, 'fx_snapshot')) throw new Error('Locked FX rates are immutable');
      if (financialFields.some((f) => touches(paths, f))) {
        if (existing.status !== 'DRAFT') throw new Error('Issued financial fields are immutable');
        query.where({ status: 'DRAFT' });
        if (touches(paths, 'fx_snapshot')) query.where({ fx_snapshot: { $exists: false } });
      }
    }
  });
}
