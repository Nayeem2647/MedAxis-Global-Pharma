import { ManufacturerModel } from '../../modules/catalog/catalog.schema.js';
import { GenericModel } from '../../modules/catalog/catalog.schema.js';
import { CategoryModel } from '../../modules/catalog/catalog.schema.js';
import { ProductModel } from '../../modules/catalog/catalog.schema.js';
import { ProductRatingModel } from '../../modules/catalog/product-rating.schema.js';
import { CustomerModel } from '../../modules/customer/customer.schema.js';
import { CustomerAccountModel, CustomerSessionModel, CustomerDraftModel, CustomerEventModel } from '../../modules/customer/account.schema.js';
import { RfqModel } from '../../modules/rfq/rfq.schema.js';
import { RfqIdempotencyKeyModel } from '../../modules/rfq/rfq.schema.js';
import { PrescriptionModel } from '../../modules/storage/storage.schema.js';
import { QuotationModel } from '../../modules/quotation/quotation.schema.js';
import { QuotationVersionModel } from '../../modules/quotation/quotation.schema.js';
import { QuotationInternalCostModel } from '../../modules/quotation/quotation.schema.js';
import { ExchangeRateModel } from '../../modules/fx/fx.schema.js';
import { AuditLogModel } from '../../modules/audit/audit.schema.js';
import { NotificationLogModel } from '../../modules/notification/notification.schema.js';
import { ClarificationMessageModel } from '../../modules/rfq/rfq.schema.js';
import { CmsBannerModel, CmsBlogModel, UrlRedirectModel } from '../../modules/cms/cms.schema.js';
import { AdminModel } from '../../modules/auth/auth.schema.js';
import { AdminSessionModel } from '../../modules/auth/auth.schema.js';
import { AuthAttemptModel } from '../../modules/auth/auth.schema.js';
import { PlatformSettingModel } from '../../modules/settings/settings.schema.js';

export const persistenceModels = [
  ManufacturerModel,
  GenericModel,
  CategoryModel,
  ProductModel,
  ProductRatingModel,
  CustomerModel,
  CustomerAccountModel,
  CustomerSessionModel,
  CustomerDraftModel,
  CustomerEventModel,
  RfqModel,
  RfqIdempotencyKeyModel,
  PrescriptionModel,
  QuotationModel,
  QuotationVersionModel,
  QuotationInternalCostModel,
  ExchangeRateModel,
  AuditLogModel,
  NotificationLogModel,
  ClarificationMessageModel,
  CmsBannerModel,
  CmsBlogModel,
  UrlRedirectModel,
  AdminModel,
  AdminSessionModel,
  AuthAttemptModel,
  PlatformSettingModel,
] as const;
