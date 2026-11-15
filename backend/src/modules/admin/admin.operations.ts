import { Router } from 'express';
import mongoose, { type QueryFilter } from 'mongoose';
import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { adminAuth } from '../../shared/middleware/adminAuth.js';
import { adminBoundary } from '../../shared/middleware/adminBoundary.js';
import { redact } from '../../shared/utils/logger.js';
import { sendPaginated, sendSuccess } from '../../shared/utils/response.js';
import { auditQuery, customerQuery, pageQuery } from '../../shared/validators/decision.validator.js';
import { uuid } from '../catalog/catalog.validator.js';
import { CustomerModel, type ICustomer } from '../customer/customer.schema.js';
import { AuditLogModel, type IAuditLog } from '../audit/audit.schema.js';
import type { AdminStream } from './admin.stream.js';

const customerProjection = {
  full_name: 1,
  customer_type: 1,
  company_name: 1,
  email: 1,
  whatsapp_number: 1,
  wechat_id: 1,
  preferred_locale: 1,
  country: 1,
  city: 1,
  created_at: 1,
  updated_at: 1,
} as const;
export function createAdminOperationsRouter(env: AppEnv, stream: AdminStream) {
  const router = Router();
  router.use(adminBoundary(env), adminAuth(env));
  router.get('/customers', async (req, res) => {
    const query = customerQuery.parse(req.query);
    const filter: QueryFilter<ICustomer> = {};
    if (query.buyer_type) filter.customer_type = query.buyer_type;
    if (query.country) filter.country = query.country;
    if (query.q) {
      const pattern = new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = ['full_name', 'company_name', 'email', 'whatsapp_number'].map((field) => ({ [field]: pattern }));
    }
    const [items, total] = await Promise.all([
      CustomerModel.find(filter)
        .select(customerProjection)
        .sort({ created_at: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      CustomerModel.countDocuments(filter),
    ]);
    sendPaginated(res, items, { ...query, totalItems: total });
  });
  router.get('/customers/:id', async (req, res) => {
    const id = uuid.parse(req.params.id);
    const query = z.object(pageQuery).strict().parse(req.query);
    const customer = await CustomerModel.findById(id).select(customerProjection).lean();
    if (!customer) throw AppError.notFound();
    const rfqs = mongoose.connection.db!.collection('rfqs');
    const [history, total] = await Promise.all([
      rfqs
        .aggregate([
          { $match: { customer_id: id } },
          { $sort: { created_at: -1, _id: -1 } },
          { $skip: (query.page - 1) * query.limit },
          { $limit: query.limit },
          {
            $lookup: {
              from: 'quotations',
              localField: '_id',
              foreignField: 'rfq_id',
              as: 'quotations',
              pipeline: [
                {
                  $project: {
                    quotation_number: 1,
                    overall_status: 1,
                    current_version: 1,
                    current_version_id: 1,
                    created_at: 1,
                  },
                },
              ],
            },
          },
          { $project: { rfq_number: 1, inquiry_type: 1, status: 1, created_at: 1, quotations: 1 } },
        ])
        .toArray(),
      rfqs.countDocuments({ customer_id: id }),
    ]);
    sendSuccess(
      res,
      { customer, history },
      {
        meta: {
          pagination: {
            page: query.page,
            limit: query.limit,
            total_items: total,
            total_pages: Math.max(1, Math.ceil(total / query.limit)),
            has_next: query.page * query.limit < total,
            has_prev: query.page > 1,
          },
        },
      },
    );
  });
  router.get('/audit-logs', async (req, res) => {
    const query = auditQuery.parse(req.query);
    const filter: QueryFilter<IAuditLog> = {};
    for (const key of ['actor_type', 'actor_id', 'entity_type', 'entity_id'] as const)
      if (query[key]) filter[key] = query[key];
    if (query.action) filter.action_type = query.action;
    if (query.date_from || query.date_to)
      filter.created_at = {
        ...(query.date_from ? { $gte: query.date_from } : {}),
        ...(query.date_to ? { $lte: query.date_to } : {}),
      };
    const [rows, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ created_at: -1, _id: -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .lean(),
      AuditLogModel.countDocuments(filter),
    ]);
    sendPaginated(
      res,
      rows.map((row) => ({
        id: row._id,
        actor_type: row.actor_type,
        actor_id: row.actor_id,
        action: row.action_type,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        old_status: row.old_status,
        new_status: row.new_status,
        request_id: row.request_id,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        metadata: redact(row.safe_changes),
        created_at: row.created_at,
      })),
      { ...query, totalItems: total },
    );
  });
  router.get('/stream', (req, res) => {
    z.object({}).strict().parse(req.query);
    stream.connect(req, res);
  });
  return router;
}
