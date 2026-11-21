# Catalog, storage, CMS and platform settings

Local development defaults to disk storage for all uploads. No S3/R2 buckets are
needed; see [local uploads](../storage/README.md) for paths, access controls and
setup. Cloud configuration below applies only when explicitly selecting S3.

All endpoints use the standard API envelope. Public product payloads include
localized specifications, active manufacturer/generic/category profiles, image
URLs, and `alternate_slugs: { en, zhCN }`. Missing Chinese content falls back to
English and reports the actual product content locale. Public reads use nested
field projections followed by explicit DTO construction; they never serialize
whole product, translation, or master documents. Prices, FX, costs, margins,
tokens and admin notes are not part of public DTO types or projections.

## Customer ratings

Run `npm run migrate:ratings` to prepare only the new `product_ratings` collection,
its strict validator and unique product/visitor index. The standard migration
also includes it. Existing product and commercial records are unchanged.

`GET /v1/public/products/:id/ratings` returns `{ average, count, my_rating }`.
`PUT` on the same path accepts strict `{ score: 1..5 }` with a whole-number score.
Only a published product with active related profiles is eligible. Writes require
an allowed `Origin` and are limited to ten per minute per IP. A signed HttpOnly
browser cookie identifies an anonymous voter; only its hash is stored. Repeating
a vote from that browser updates its existing row. These are customer ratings,
not verified-purchase reviews or medical review metadata. No written reviews are
collected. Personal rating reads and writes use `no-store`.

Catalog lists/details include public `customer_rating: { average, count }` only.
Aggregates are computed from stored votes after pagination, without exposing
visitor identifiers. The catalog cards refresh their displayed totals separately
so a cached catalog page does not hide a newly submitted rating.

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

Generic therapeutic indications accept paragraphs: up to 100 entries and 5000
characters in total. Frontend, API, MongoDB validation and public DTO readers use
compatible limits. Admin slug fields normalize spaces and punctuation to hyphens;
they are single URL paths, not search-tag lists.

POST `/v1/admin/catalog/translate-indications` accepts strict `{ text }` (English,
1–5000 characters), requires full admin authentication and the existing Origin
boundary, and returns `{ translated_text, source_language: "en", target_language:
"zh-CN" }`. It is rate-limited to 20 requests/minute and translates on the server
through DeepL to Simplified Chinese. Set `DEEPL_API_KEY` in `backend/.env` and
restart the backend; Free keys ending in `:fx` use `api-free.deepl.com`, other
keys use `api.deepl.com`. Keys never reach the browser. Translation has a ten-second
provider deadline and no automatic retries, since provider calls may be billed.

The generic editor fills an empty Chinese description automatically after typing
pauses. Existing descriptions start in manual mode; opting in replaces them on
successful translation. Manual edits stop automatic filling and cancel pending
results. Source changes discard stale responses. Errors preserve the description
and permit manual saving. Generated medical text must be reviewed before saving;
generation clears the existing verification checkbox. Translation does not save
or publish a record. Missing keys, provider quota exhaustion and failures have
distinct error messages. Apply `npm run migrate` for the new indication length.

All admin routes require the signed full admin session. They use `no-store`
and reject explicit mutation origins outside `PUBLIC_ORIGIN`.

DELETE `/v1/admin/catalog/{products|manufacturers|generics|categories}/:id`
requires the record's latest `expected_updated_at` ISO timestamp in a strict
JSON body and accepts no query parameters. It returns `{ id, deleted: true }`.
A stale timestamp returns 409; a master still referenced by any non-deleted
product (including drafts and archived products) returns 422. Reassign or
delete those products first.

Deletion records `deleted_at` and archives a product or deactivates a master.
Deleted records disappear from admin lists, pickers, detail pages, public
catalog pages and sitemaps. Records and uploaded images remain available to
historical RFQs and quotations; existing SKUs and slugs remain reserved.
Editing or importing cannot resurrect a deleted entry. Repeating a completed
deletion succeeds without duplicating the deletion audit event. The admin list
button acts immediately, without a confirmation dialog or automatic retries.
Run `npm run migrate` when updating an existing development database so its
strict collection validators accept the optional `deleted_at` field.

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

POST `/v1/admin/catalog/images` accepts multipart field `image`, maximum 25 MiB.
Actual content must be JPEG, PNG or WebP. The response contains an opaque
`object_key`, public CDN URL, MIME type and size. Put that key into a product's
`image_keys`; original filenames are not used as storage keys.

Product writes accept at most six ordered `image_keys`: the first is the main
picture and the remaining five are additional pictures. Optional `seo_image_key`
selects a separate social sharing image; metadata falls back to the main image.
POST `/v1/admin/catalog/videos` accepts one multipart `video` (MP4 or WebM,
maximum 100 MiB), checks the actual file type, and returns the same upload receipt
shape. Persist its key as optional `video_key`. Local development stores videos
under `products/local/videos/` and serves byte ranges for playback and seeking.
Videos never require a third-party embed or block publishing when omitted.

PATCH accepts `video_key: null`, `seo_image_key: null`, `storage_condition: null`
and null optional translated text fields to remove saved values. Omission
preserves saved values. Public DTOs expose approved `video_url`, `seo_image_url`
and sanitized `description_html`, never storage credentials. Rich descriptions
allow basic paragraphs, headings, emphasis and lists. Search descriptions remain
plain text. The search preview matches public title/description fallbacks;
canonical, language links and price-free structured data are preserved. Apply
`npm run migrate` to existing development databases before saving media fields.

POST `/v1/admin/catalog/generics`, `/manufacturers`, and `/categories` create
masters or update an existing master when `id` is supplied. Updates are full
profile submissions. Each accepts `translations.en: { name, slug }`, optional
`translations.zhCN`, and `is_active`. Manufacturers accept optional `country`
and `certifications`. Omitting `country` when editing preserves the existing value. Generic accepts
`therapeutic_indications`; category accepts `sort_order`. Translation SEO and
description fields match the database schema. Manufacturer/generic name changes
update the corresponding materialized product search labels transactionally.

English and Chinese page slugs must be unique within each master directory,
including inactive records. Duplicate submissions return `422 CATALOG_SLUG_CONFLICT`
with the conflicting `translations.en.slug` / `translations.zhCN.slug` fields.
Edit the existing master by supplying its `id`, or choose a different slug for a
different master. Edits may keep their own slugs. Unique indexes also protect
against simultaneous duplicate submissions; rejected staged logos are removed.

Manufacturer submissions can include a PNG or WebP `logo_data_url` up to 262,144
characters. Omit it to keep the saved logo or send `null` to remove it. In S3 mode,
replacement and new logos use object storage. The authenticated manufacturer
detail endpoint returns the image source for both inline and S3 logos.

The Generic API retains the optional `logo_data_url` image field with
the same PNG/WebP validation and size limit for existing installations. Generic
admin forms, lists and previews omit picture controls and image display;
ordinary edits leave any existing stored picture unchanged. Generic pictures use
`products/local/generics/` locally. Omit the field to retain a saved picture or
send `null` to remove it. Detail responses include its image URL in
`logo_data_url`; list responses include `logo_url`. Replacement/removal deletes
the retired file only after the database transaction commits.

Categories use the same optional image field and lifecycle under
`products/local/categories/`. Category updates and status switches keep the
saved picture when that field is omitted; `sort_order` remains part of every
category submission. Generic/category storage failures return the dedicated
`GENERIC_IMAGE_UPLOAD_FAILED` / `CATEGORY_IMAGE_UPLOAD_FAILED` codes before any
database write, allowing a corrected manual submission.

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

## S3, encryption and revalidation

Configure `AWS_REGION`, `S3_BUCKET_PRODUCTS`, `S3_BUCKET_QUOTES`,
`S3_BUCKET_PRESCRIPTIONS`, `S3_BUCKET_AVATARS` and `S3_PUBLIC_BASE_URL`.
Use the backend runtime role for S3. See the [AWS runbook](../../../../infra/aws/README.md)
for provisioning and migration. Catalog image keys use `products/s3/` and
are served through CloudFront. The old R2 settings support legacy reads only.

`storage.service.ts` exports a lazy, injectable S3 service with image upload,
private prescription upload/download, and bucket-scoped operations. Prescription
helpers accept only actual JPEG/PNG/PDF buffers up to 5,242,880 bytes, encrypt
with AES-256-GCM before upload, and authenticate/decrypt on download. Configure
`PRESCRIPTION_ENCRYPTION_KEY` (32 bytes in hex/base64) and `PRESCRIPTION_KEY_ID`.
Medical metadata contains `object_key`, MIME/size and
`encryption: { algorithm, iv, auth_tag, key_id }`; it has no public URL or key
material. The authorized RFQ stream reads old `r2_storage_key` references
during the transition.

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
upload test objects into live storage buckets.
