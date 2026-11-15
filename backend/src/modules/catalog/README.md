# Catalog, storage, CMS and platform settings

All endpoints use the standard API envelope. Public product payloads include
localized specifications, active manufacturer/generic/category profiles, image
URLs, and `alternate_slugs: { en, zhCN }`. Missing Chinese content falls back to
English and reports the actual product content locale. Public reads use nested
field projections followed by explicit DTO construction; they never serialize
whole product, translation, or master documents. Prices, FX, costs, margins,
tokens and admin notes are not part of public DTO types or projections.

## Public endpoints

| Method / path                        | Behavior                                                             |
| ------------------------------------ | -------------------------------------------------------------------- |
| GET `/v1/public/products`            | Published products, facets and pagination                            |
| GET `/v1/public/products/:slug`      | Localized product detail                                             |
| GET `/v1/public/generics/:slug`      | Active generic profile and paginated products                        |
| GET `/v1/public/manufacturers/:slug` | Active manufacturer profile and paginated products                   |
| GET `/v1/public/categories/:slug`    | Active category profile and paginated products                       |
| GET `/v1/public/sitemap-catalog`     | Indexable localized slug pairs and `updated_at`                      |
| GET `/v1/public/cms/banners`         | Active banners within their scheduled dates, ordered by `sort_order` |

Catalog queries accept `page` (default 1), `limit` (default 20, maximum 100),
`locale` (`en` or `zh-CN`), `q`, `manufacturer`, `generic`, `category`,
`dosage_form`, and `cold_chain=true|false`. Master filters use localized slugs.
Hub pages accept the same query parameters. Product detail and banners accept
`locale`; the sitemap accepts no query parameters.

Production text searches use Atlas Search index `products_public_catalog`.
Install `../../scripts/atlas-search-index.json` separately in Atlas; ordinary
MongoDB migrations do not install Search indexes. Development/test uses escaped
literal regex with bounded queries. Production does not silently fall back
when its search index is unavailable. Product-list requests are limited to 120
per minute per IP.

Products require a published status, active manufacturer and generic, and at
least one active category to appear publicly or in the sitemap. Historical
slugs return a JSON success envelope with status 301, a `Location` header and
`data.redirect: { status: 301, location }`. Locations are canonical frontend
paths such as `/en/products/new-slug`. Missing/hidden targets return
`404 RESOURCE_NOT_FOUND`.

## Admin catalog and uploads

All admin routes require the signed full admin session. They use `no-store`
and reject explicit mutation origins outside `PUBLIC_ORIGIN`.

POST `/v1/admin/catalog/products` accepts:

```json
{
  "sku": "DEMO-001",
  "manufacturer_id": "00000000-0000-4000-8000-000000000001",
  "generic_id": "00000000-0000-4000-8000-000000000002",
  "category_ids": ["00000000-0000-4000-8000-000000000003"],
  "translations": {
    "en": { "brand_name": "Demo Medicine", "slug": "demo-medicine" },
    "zhCN": { "brand_name": "示例药品", "slug": "demo-medicine-zh" }
  },
  "strength": "10 mg",
  "dosage_form": "Tablet",
  "pack_size": "10 tablets",
  "packaging_unit": "BOX",
  "cold_chain_required": false,
  "storage_condition": "Store below 25C",
  "image_keys": [],
  "status": "DRAFT"
}
```

Product translations optionally contain `description`, `seo_title`,
`meta_description`, `indication_summary`, `usage_notes`, `storage_condition`,
and `image_alt_text`. Rich text is sanitized before storage and public output.
Unknown fields, including prices, are rejected. Slugs support Unicode letters,
marks and numbers separated by hyphens. UUID references must be v4.

PATCH `/v1/admin/catalog/products/:id` accepts partial fields and nested partial
translations, e.g. `{ "translations": { "en": { "slug": "new-slug" } } }`.
`translations.zhCN: null` removes the Chinese translation. Referenced masters
must be active; configured packaging units are enforced. Products, materialized
search labels, audit records and published-slug redirects commit in a single
transaction. Historical redirects are flattened to the current slug, and
historical source slugs are reserved against reuse to prevent loops. Writes
touch referenced masters to serialize against concurrent name/deactivation
changes. Atlas / replica-set transactions are required.

POST `/v1/admin/catalog/images` accepts multipart field `image`, maximum 5 MiB.
Actual content must be JPEG, PNG or WebP. The response contains an opaque
`r2_object_key`, public CDN URL, MIME type and size. Put that key into a product's
`image_keys`; original filenames are not used as storage keys.

POST `/v1/admin/catalog/generics`, `/manufacturers`, and `/categories` create
masters or update an existing master when `id` is supplied. Updates are full
profile submissions. Each accepts `translations.en: { name, slug }`, optional
`translations.zhCN`, and `is_active`. Manufacturer additionally requires
`country` and optionally `certifications`. Generic accepts
`therapeutic_indications`; category accepts `sort_order`. Translation SEO and
description fields match the database schema. Manufacturer/generic name changes
update the corresponding materialized product search labels transactionally.

## CSV import

POST `/v1/admin/catalog/import-csv?dry_run=true|false` accepts multipart field
`file`. `dry_run` defaults to true and may instead be a multipart text field;
conflicting values are rejected. Limits: 5 MiB, 1000 rows, 64 KiB per record.
UTF-8 BOM and quoted CSV fields are supported; duplicate/unknown headers and
malformed records are rejected.

Required columns:

```csv
sku,manufacturer_slug,generic_slug,category_slugs,brand_name_en,slug_en,strength,dosage_form,pack_size,packaging_unit
DEMO-001,demo-maker,demo-ingredient,oncology|hematology,Demo Medicine,demo-medicine,10 mg,Tablet,10 tablets,BOX
```

Reference slugs are English canonical slugs; multiple categories use `|`.
Optional columns: `brand_name_zhCN`, `slug_zhCN`, `description_en`,
`description_zhCN`, `indication_summary_en`, `indication_summary_zhCN`,
`usage_notes_en`, `usage_notes_zhCN`, `seo_title_en`, `seo_title_zhCN`,
`meta_description_en`, `meta_description_zhCN`, `storage_condition`,
`cold_chain_required` (exact `true` or `false`) and `status`
(`DRAFT`, `PUBLISHED`, `ARCHIVED`; default DRAFT).

Dry runs return row numbers, SKUs, validity and field errors without any database
or webhook writes. Invalid commits return 422 with fields such as
`rows[3].manufacturer_slug`. Valid commits upsert by normalized SKU in one
transaction and return 202. Any row or audit failure rolls back the entire
batch. Import does not create missing masters.

## CMS and settings

POST `/v1/admin/cms/banners` accepts `translations.en: { title, body }`, optional
Chinese translation, `sort_order`, `is_active`, ISO `starts_at`/`ends_at`, and a
safe relative `link_path`. Supply `id` to replace an existing banner profile.

GET `/v1/admin/settings` returns allowlisted settings as
`{ setting_key: { value, updated_at } }`. PATCH accepts one or more named settings
and replaces each supplied value atomically:

```json
{
  "packaging_units": { "units": ["BOX", "BOTTLE", "VIAL"] },
  "wire_instructions": { "configured": false, "instructions": "Awaiting bank verification" },
  "payment_presets": {
    "terms": ["BANK_WIRE_TT"],
    "quote_validity_days": 7,
    "reservation_days": 5,
    "business_timezone": "Asia/Dhaka"
  },
  "shipping_presets": { "methods": ["INCOTERM", "EXPRESS_COURIER"], "incoterms": ["FCA", "CIP", "DAP"] }
}
```

Configured wire instructions additionally require `beneficiary_name`,
`bank_name`, `account_number`, and `swift_code`; `bank_address` and `currency`
are optional. Sensitive bank values are not copied into audit metadata.

## R2, encryption and revalidation

Configure `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET_PRODUCTS`, `R2_BUCKET_QUOTES`, `R2_BUCKET_PRESCRIPTIONS`, and
`R2_PUBLIC_BASE_URL` (the public product-image CDN base). The SDK uses region
`auto` and `https://<account>.r2.cloudflarestorage.com`. Logical object keys use
`products/`, `quotes/`, and `prescriptions/` prefixes. Only product keys can be
converted into public URLs. Quotes and medical objects must remain private.

`storage.service.ts` exports a lazy, injectable R2 service with image upload,
private prescription upload/download, and bucket-scoped operations. Prescription
helpers accept only actual JPEG/PNG/PDF buffers up to 5,242,880 bytes, encrypt
with AES-256-GCM before upload, and authenticate/decrypt on download. Configure
`PRESCRIPTION_ENCRYPTION_KEY` (32 bytes in hex/base64) and `PRESCRIPTION_KEY_ID`.
Medical metadata contains `r2_object_key`, MIME/size and
`encryption: { algorithm, iv, auth_tag, key_id }`; it has no public URL or key
material. At the later RFQ persistence boundary, map `r2_object_key` to the
canonical prescription schema's `r2_storage_key`. Step 5 will expose the
prescription intake/authorized streaming endpoints.

After a committed mutation, a non-blocking POST is sent to each configured
`PUBLIC_ORIGIN` at `/api/revalidate`, with bearer
`REVALIDATE_WEBHOOK_SECRET` and `tags: ["catalog", "cms", "settings"]`.
Calls have a five-second timeout and reject external redirects. Failure is
logged with request ID without undoing committed data or exposing the token.

## Verification

```sh
npm run typecheck
npm run build
npm run lint
npm test
npm run test:catalog
```

Catalog integration tests use `MONGODB_TEST_URI` or `MONGODB_URI` to create and
remove only a unique `catalog_test_*` database. They exercise actual validators,
transactions, public projections, localization, references, redirects, CSV,
CMS and settings. Webhooks are stubbed. Storage unit tests mock the S3 transport
and verify real magic-byte detection and encryption round trips; they do not
upload test objects into live R2 buckets.
