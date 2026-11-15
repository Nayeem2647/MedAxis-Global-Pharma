# MedAxis Global Pharma — Requirement Validation Report
**Document Code:** RV-DOC-2026-01  
**Based On:** PRD.md v1.1 (Post Owner Decision Lock — 13 November 2026)  
**Validation Categories:** Missing Flow · Edge Case · Error Handling · Security · Validation · Permission · Notification · Exception  
**Analyst Role:** Senior Product Analyst & Business Analyst  
**Status:** ⚠️ Open Items Identified — Requires Engineering Decision Before Development

---

> [!IMPORTANT]
> **Legend:**
> - ✅ **COVERED** — PRD clearly defines this requirement
> - ⚠️ **PARTIAL** — PRD mentions it but lacks sufficient detail for engineering
> - ❌ **MISSING** — PRD does not address this at all; engineering team will need a spec or business decision

---

## 1. 🔀 Missing Flows

Flows that exist in the business workflow but are absent or incomplete in the PRD user flow diagrams.

| ID | Missing Flow | Severity | Details & Required Spec |
| :--- | :--- | :--- | :--- |
| **MF-01** | **Uncatalogued Product RFQ → Admin Matching Flow** | ⚠️ HIGH | PRD mentions "Send Your Requirement" fallback for zero search results (Section 3.1), and `RFQ_ITEM` has `is_uncatalogued` flag. But there is **no defined flow** for how the Super Admin processes and resolves an uncatalogued item — does the admin manually create a new product from the RFQ, or just respond free-form? This flow needs to be specified. |
| **MF-02** | **Quotation Validity Expiry → Customer Re-Engagement Flow** | ❌ HIGH | The PRD states expired quotations show "Contact Admin for Refresh" on the Magic Link page. But there is no defined flow for: (a) how the customer contacts admin from an expired link, (b) whether admin can re-activate the same version or must create a new revision `v2`, (c) what happens to the old Magic Link token. |
| **MF-03** | **5-Day Payment Reservation Expiry → Stock Release Flow** | ⚠️ HIGH | The state machine shows `Payment Expired / Stock Released` status. But the PRD does not specify: (a) Is the customer notified by email when their reservation expires? (b) Can the admin manually extend the 5-day window? (c) Can the customer re-accept the same quotation after expiry, or does admin need to re-issue? |
| **MF-04** | **Customer Requests Revision (from Magic Link)** | ❌ MEDIUM | The PRD describes the buyer chatting on WhatsApp/WeChat to negotiate and admin then creating a revision. But there is no formal "Request Revision" button or flow on the Magic Link page — the buyer's only options are Accept, Chat, or Decline. If buyer clicks Decline and then changes mind, can they still negotiate? The revision-trigger flow from the customer side is missing. |
| **MF-05** | **Same Customer Submitting Multiple RFQs (Repeat Buyer)** | ⚠️ MEDIUM | PRD mentions background identity linkage by email/phone, and that old quotation prices are not automatically valid. But no flow exists for: (a) How the admin queue looks when the same customer has multiple open RFQs simultaneously, (b) How the admin links or distinguishes them, (c) Whether the customer sees a list of their own past RFQs anywhere. |
| **MF-06** | **B2B Cart RFQ with Partial Product Availability** | ✅ COVERED | Specced in PRD.md Section 3.2. Admin sets `item_availability_status` (`AVAILABLE`, `UNAVAILABLE`, `SOURCING`) per line. Admin issues partial quote with available items; unavailable items retained with customer-visible reason note. |
| **MF-07** | **Admin Marks Delivery — No Confirmation from Customer** | ⚠️ MEDIUM | The final fulfillment step is `Mark Delivered` triggered by the admin. But the PRD does not specify what happens if the customer claims they did NOT receive the delivery. There is no customer dispute or delivery confirmation step in Release 1. |
| **MF-08** | **Product Publish → Archive Flow for Active RFQs** | ❌ MEDIUM | PRD states archived products still appear in old quotation history (Section 4 of Idea.md). But the PRD does not define what happens when a product currently in an open/active RFQ is archived mid-process. Does the RFQ become invalid? Does admin get a warning? |
| **MF-09** | **Admin Cannot Process RFQ (Product Unavailable)** | ✅ COVERED | Specced in PRD.md Section 3.3. Admin clicks "Unable to Supply" action, selects reason, adds note. RFQ transitions to `Closed` with `close_reason: "Unable to Supply"` and automated email sent to buyer. |
| **MF-10** | **Customer Email Delivery Failure → Fallback Flow** | ❌ HIGH | PRD says email failures are logged to `NOTIFICATION_LOG` and RFQ records are not rolled back. But there is no defined **fallback flow** — if the Magic Link email to a Chinese buyer bounces, what does the system or admin do next? Manual WhatsApp? Admin retry? Automatic retry count? |

---

## 2. 🧩 Edge Cases

Unusual but realistic scenarios that the system must handle gracefully.

| ID | Edge Case | Severity | Details & Required Spec |
| :--- | :--- | :--- | :--- |
| **EC-01** | **Same email submitted by two different buyers simultaneously (race condition)** | ⚠️ HIGH | PRD says the system "idempotently creates or associates" a Customer Profile using phone/email. But what if two different people submit the same email (e.g., company shared email)? Who owns the profile? Who sees the Magic Links? |
| **EC-02** | **Buyer forwards Magic Link to a colleague who also clicks Accept** | ⚠️ HIGH | With no OTP (BD-001), if Buyer A forwards the Magic Link to Buyer B, and Buyer B clicks Accept — the quotation gets accepted by an unauthorized party. The PRD acknowledges the Magic Link is the "proof of identity" but does not address this forwarding scenario. |
| **EC-03** | **Admin accidentally sends the same Magic Link to two different customers** | ❌ HIGH | If the admin manually sends a Magic Link to the wrong customer via WhatsApp, that customer can view and accept another buyer's private quotation. The PRD does not define any guards for this. |
| **EC-04** | **Buyer clicks Accept on an already-Accepted quotation (double-click / page refresh)** | ⚠️ HIGH | The PRD mentions idempotency for RFQ submission but does not define idempotency for the Accept action. If the same buyer clicks Accept twice (e.g., slow connection + retry), does the system create two accepted records or handle it gracefully? |
| **EC-05** | **Admin edits quotation after it has been sent but before customer opens it** | ❌ MEDIUM | PRD says `Sent` quotations can only be revised by creating a new version. But what if admin notices an error (e.g., wrong price) immediately after sending? Can a sent quotation be retracted/recalled before the buyer opens it? |
| **EC-06** | **Quotation expires exactly when buyer is in the process of clicking Accept** | ⚠️ MEDIUM | Race condition: quotation validity expires at midnight on day 7. Buyer opens the Magic Link at 11:59 PM. The PRD does not define whether the system checks validity at page-load or at the moment the Accept button is clicked. |
| **EC-07** | **CSV Bulk Import contains a manufacturer name that doesn't exist in master data** | ⚠️ HIGH | PRD says the CSV importer has "schema validation, error highlighting, and duplicate skipping." But it does not specify what happens when a CSV row references a Manufacturer that hasn't been created yet — is the row rejected, or does the system auto-create the manufacturer? |
| **EC-08** | **Customer submits Quick Quote with an invalid phone number format** | ⚠️ MEDIUM | The Quick Quote form captures WhatsApp/WeChat number. If the buyer enters an invalid number (e.g., "12345" or a landline), the Magic Link email/WhatsApp delivery will fail silently. No validation rule for phone format is defined. |
| **EC-09** | **Admin tries to create a revision on an Expired quotation** | ❌ MEDIUM | The PRD allows admin to create revision `v2` on `Sent` quotations. But what happens if the quotation has already `Expired`? Can admin revive it? The state machine does not show `Expired → revision` path. |
| **EC-10** | **Two RFQs with the same product, same customer, same day** | ⚠️ LOW | The duplicate guard is defined for the same RFQ submission (double-click). But if a customer submits a Quick Quote for Product A and then also adds Product A to a Cart RFQ on the same day, the system would create two RFQs. No business rule defines whether these should be merged or treated separately. |
| **EC-11** | **Customer accepts a quotation for a product that the admin forgot to verify stock for** | ❌ HIGH | The workflow assumes the admin verifies stock BEFORE issuing a quotation. But there is no system-enforced gate that prevents sending a quotation without logging a stock verification step. If admin sends an unverified quote and customer accepts, the system has no "oops, stock unavailable post-acceptance" flow. |
| **EC-12** | **Geo-IP returns wrong country (VPN user misidentified as China)** | ⚠️ LOW | A buyer in Thailand using a VPN routed through Shanghai would be incorrectly routed to `/zh-CN/`. The PRD says the language switcher can override this, but the first-visit experience would be wrong. No specific handling for VPN misidentification is defined. |

---

## 3. ⚠️ Error Handling

How the system responds to failures, bad inputs, and unexpected states.

| ID | Error Scenario | Status | Details & Required Spec |
| :--- | :--- | :--- | :--- |
| **EH-01** | **RFQ confirmation email fails to send** | ✅ COVERED | PRD Section 7 states: email failures log to `NOTIFICATION_LOG`; RFQ record is not rolled back. Admin can inspect failures. |
| **EH-02** | **Magic Link email delivery fails (China bounce)** | ⚠️ PARTIAL | PRD says failures are logged. But no retry logic, retry count limit, or admin alert for persistent delivery failure is defined. How many retries? After how long? |
| **EH-03** | **PDF generation fails during quotation send** | ❌ MISSING | PRD requires dynamic PDF generation on quotation issuance. But there is no defined error handling if the PDF renderer crashes or times out. Does the quotation remain in `Draft`? Does the admin see an error? |
| **EH-04** | **Prescription file upload fails mid-upload (network drop)** | ⚠️ PARTIAL | PRD defines client-side and server-side validation for file size/type but does not specify what happens if the upload connection drops mid-transfer. Is there a resumable upload or just a retry with error message? |
| **EH-05** | **CSV Bulk Import partially fails (50 of 100 rows valid)** | ⚠️ PARTIAL | PRD mentions "schema validation, error highlighting." But it does not define whether the import is atomic (all-or-nothing) or partial (import valid rows, reject invalid). This is critical for the admin workflow. |
| **EH-06** | **Live FX rate API is down when admin opens Fast-Quote console** | ⚠️ PARTIAL | PRD mentions Dual FX Mode (Live + Manual Fixed). But it doesn't specify what happens if the live rate API is unavailable — does the system automatically fall back to the last-known Manual Fixed rate? Does it block the admin? |
| **EH-07** | **Database write failure when buyer clicks Accept** | ❌ MISSING | If the database transaction for locking the quotation to `Accepted` fails (e.g., DB timeout), the buyer has already received a success confirmation UI. The PRD does not define the rollback or retry behavior for this critical write. |
| **EH-08** | **Admin session times out while drafting a quotation** | ⚠️ PARTIAL | PRD defines 30-minute idle session timeout for the admin. But it does not specify whether draft quotation data is auto-saved to the DB (so work is not lost on timeout) or discarded. |
| **EH-09** | **Duplicate RFQ submitted (double-click / page refresh)** | ✅ COVERED | PRD Section 3.2 defines idempotency guard for RFQ submission. |
| **EH-10** | **Invalid/expired Magic Link accessed** | ✅ COVERED | PRD states: accessing `/q/[invalid_token]` returns HTTP 404 without DB enumeration. |
| **EH-11** | **Quotation Accept clicked on a Superseded version** | ✅ COVERED | PRD Section 6.1 (Rule 5): superseded quotation versions cannot be accepted. |
| **EH-12** | **Slug collision when two products are given the same slug** | ⚠️ PARTIAL | PRD says slugs must be unique (UK constraint in DB). But the error message/UX when a slug collision occurs in the admin panel is not defined. Does the system auto-append a suffix, or show a validation error? |

---

## 4. 🔐 Security

Security requirements, potential attack surfaces, and gaps in the PRD's security model.

| ID | Security Area | Status | Details & Required Spec |
| :--- | :--- | :--- | :--- |
| **SEC-01** | **Super Admin TOTP 2FA enforcement** | ✅ COVERED | Mandatory TOTP 2FA, 30-min idle lockout, brute-force 5-attempt IP lockout (15 mins), cryptographic recovery codes. |
| **SEC-02** | **Magic Link token entropy & storage** | ✅ COVERED | 256-bit CSPRNG token, SHA-256 hashed in DB, 30 req/min rate-limiting per IP. |
| **SEC-03** | **Internal cost/margin data isolation** | ✅ COVERED | `internal_cost_data` JSON field never exposed in customer API payloads, PDFs, or Magic Link views. |
| **SEC-04** | **Customer data Row-Level Security (RLS)** | ✅ COVERED | Customer A cannot access Customer B's RFQs, quotations, prescriptions, or profile data. |
| **SEC-05** | **Magic Link forwarding / sharing attack** | ❌ MISSING | With no OTP (BD-001 decision), a forwarded Magic Link gives the recipient full access to view and **accept** the quotation. The PRD acknowledges the token as "proof of identity" but provides no mitigation: no IP binding, no one-time-use restriction on Accept action, no warning on first view from a new IP. This is a **significant security gap** for high-value pharmaceutical orders. **Recommended**: Log the IP and device of every Magic Link access; alert admin if accessed from a new geography. |
| **SEC-06** | **Prescription file access control** | ✅ COVERED | Stored in encrypted blob storage; AES-256 at rest; access restricted to Super Admin only; 90-day auto-purge. |
| **SEC-07** | **Admin panel route protection** | ✅ COVERED | `/admin/*` routes require active 2FA session; returns 401/403 without it. |
| **SEC-08** | **Private quotation pages blocked from indexing** | ✅ COVERED | `X-Robots-Tag: noindex, nofollow, noarchive` on `/q/[token]`, PDFs, prescriptions. |
| **SEC-09** | **SQL injection / API enumeration on Magic Link endpoint** | ✅ COVERED | Tokens are hashed; invalid tokens return HTTP 404 without revealing DB state (no enumeration). |
| **SEC-10** | **CSRF protection on RFQ submission and Accept action** | ❌ MISSING | The PRD does not mention CSRF token protection on form submissions (Quick Quote, Cart RFQ, Accept Quotation). Without CSRF protection, a malicious page could trick a logged-in customer into submitting a fake RFQ or accepting a quote. |
| **SEC-11** | **Content Security Policy (CSP) headers** | ❌ MISSING | Especially important for the GFW-resilient China-safe stack. PRD does not mention CSP headers to restrict what external scripts can load on the platform. |
| **SEC-12** | **Admin panel HTTPS / TLS enforcement** | ⚠️ PARTIAL | PRD mentions TLS 1.3 for data in transit but doesn't explicitly state that HTTP → HTTPS redirects are enforced at the edge for all routes. |
| **SEC-13** | **Rate limiting on RFQ submission (spam/abuse)** | ⚠️ PARTIAL | PRD mentions Cloudflare Turnstile / hCaptcha for form bot protection but does not define a per-IP or per-email rate limit on RFQ submissions. A bad actor could submit thousands of fake inquiries. |
| **SEC-14** | **Signed URL expiry for prescription downloads** | ⚠️ PARTIAL | PRD says prescriptions are stored in encrypted blob storage with signed URLs. But it doesn't define the expiry duration of signed URLs — a leaked signed URL could give unauthorized access after the fact. |

---

## 5. ✔️ Validation

Input validation, form rules, and data integrity checks.

| ID | Validation Area | Status | Details & Required Spec |
| :--- | :--- | :--- | :--- |
| **VAL-01** | **Quick Quote: 4 required fields** | ✅ COVERED | Full Name, WhatsApp/Email, Country, Quantity + Packaging Unit are required. |
| **VAL-02** | **Packaging Unit mandatory on Cart RFQ** | ✅ COVERED | Attempting to submit without a packaging unit triggers a form validation error. |
| **VAL-03** | **Prescription file: type & size** | ✅ COVERED | JPEG, PNG, PDF only; max 5MB; client-side + server-side validation. |
| **VAL-04** | **Email format validation** | ⚠️ PARTIAL | PRD requires email as a contact field but does not explicitly define email format validation rules or what happens when an invalid email is entered (e.g., `abc@` or `abc`). |
| **VAL-05** | **Phone/WhatsApp number format validation** | ❌ MISSING | No validation rules defined for phone number format. International format (`+8801XXXXXXXXX`), China format (`+86XXXXXXXXXXX`), or local format — all need rules. |
| **VAL-06** | **Quantity field: positive integer only** | ⚠️ PARTIAL | PRD implies positive quantity is required but doesn't explicitly state the validation rule (min value, integer-only, no decimals for most medicines). |
| **VAL-07** | **Markup % field: range validation** | ❌ MISSING | The Fast-Quote Engine accepts a "Target Markup %" input. No validation is defined — can admin enter 0%? Negative markup? 10,000%? A minimum and maximum range should be defined. |
| **VAL-08** | **Quotation validity date: cannot be in the past** | ❌ MISSING | Admin can manually edit the default 7-day validity. No validation prevents setting a validity date in the past, which would create an already-expired quotation on send. |
| **VAL-09** | **CSV Bulk Import: required column validation** | ⚠️ PARTIAL | PRD mentions "schema validation and error highlighting" but doesn't specify exactly which columns are required vs optional in the CSV template. |
| **VAL-10** | **Slug format validation** | ⚠️ PARTIAL | PRD says slugs are "auto-slugified with manual override" but doesn't define what characters are allowed/rejected (e.g., spaces, uppercase, special characters like `&`, `%`). |
| **VAL-11** | **SEO title character limit enforcement** | ✅ COVERED | PRD specifies `seo_title` 50–60 char preview and `meta_description` 120–155 char SERP preview in the Admin SEO CMS panel. |
| **VAL-12** | **Destination country: valid country selection** | ⚠️ PARTIAL | Quick Quote and Cart RFQ capture Destination Country. PRD does not specify if this is a free-text field or a dropdown of valid countries. Free-text allows misspellings and inconsistency. |
| **VAL-13** | **Procurement cost: must be greater than zero** | ❌ MISSING | The Fast-Quote Engine requires the admin to input a procurement cost in BDT. No validation prevents entering zero or a negative value, which would produce a nonsensical quoted price. |

---

## 6. 🛡️ Permission

Access control, role boundaries, and what each actor can and cannot do.

| ID | Permission Area | Status | Details & Required Spec |
| :--- | :--- | :--- | :--- |
| **PERM-01** | **Super Admin: full unrestricted access** | ✅ COVERED | Super Admin has full access to all modules: catalog, RFQ, quotation, fulfillment, settings, audit log. |
| **PERM-02** | **Guest (unauthenticated) can submit Quick Quote and Cart RFQ** | ✅ COVERED | No login required for RFQ submission. |
| **PERM-03** | **Guest: zero access to product pricing data** | ✅ COVERED | Public pages strictly exclude pricing. Unauthenticated API endpoints return no price data. |
| **PERM-04** | **Magic Link holder: can view and act on their own quotation only** | ✅ COVERED | Token grants access strictly to that specific quotation version; other customer records are isolated. |
| **PERM-05** | **Customer A cannot access Customer B's data** | ✅ COVERED | Row-Level Security (RLS) enforced at database level. |
| **PERM-06** | **Customer dashboard access control (email OTP login)** | ⚠️ PARTIAL | PRD mentions optional self-service portal accessible via "email OTP or optional account password." But the permission scope of this portal is not fully defined — can the customer see ALL their past RFQs? All quotation versions including Superseded ones? |
| **PERM-07** | **Who can archive a product?** | ⚠️ PARTIAL | PRD says Super Admin manages product lifecycle (Draft → Review → Published → Archived). But it doesn't specify if archiving a product that is currently referenced in an open RFQ or active quotation is allowed, and what guard/warning should appear. |
| **PERM-08** | **Who can re-open a Declined or Closed RFQ?** | ❌ MISSING | Once an RFQ is `Declined` or `Closed`, the PRD does not define if the Super Admin can re-open it. If a customer changes their mind after declining, can the admin re-activate the quotation or must a new RFQ be submitted? |
| **PERM-09** | **Who can delete an RFQ or quotation record?** | ❌ MISSING | PRD defines archiving and status transitions but never explicitly states whether any actor can permanently delete an RFQ or quotation record. The audit log implies immutability, but a hard delete permission rule is not defined. |
| **PERM-10** | **Admin can view prescription files; customer cannot** | ✅ COVERED | Prescription files are accessible exclusively to the Super Admin in the Prescription Review Console. |
| **PERM-11** | **Internal cost and margin data: admin-only** | ✅ COVERED | `internal_cost_data` JSON field and procurement costs never appear in customer-facing APIs, PDFs, or payloads. |
| **PERM-12** | **Who can mark fulfillment milestones (Payment Received, Dispatched, Delivered)?** | ✅ COVERED | Only the Super Admin can click the 3 milestone checkmarks in the Accepted/Action Required queue. |
| **PERM-13** | **Can the customer cancel an Accepted quotation?** | ❌ MISSING | Once the customer clicks `Accept`, the quotation is `Locked`. The PRD does not define whether the customer (or admin) can cancel an accepted quotation before the 5-day payment window expires. What is the cancellation flow? |

---

## 7. 🔔 Notification

System-generated communications: emails, alerts, in-app messages, and admin notifications.

| ID | Notification Event | Status | Details & Required Spec |
| :--- | :--- | :--- | :--- |
| **NOTIF-01** | **Customer receives RFQ confirmation after submission** | ✅ COVERED | Instant on-screen success + WhatsApp & Email confirmation alert dispatched. |
| **NOTIF-02** | **Admin receives new RFQ alert in dashboard** | ✅ COVERED | New RFQ pushed to central Admin inbox with WhatsApp action icon. |
| **NOTIF-03** | **Customer receives Magic Link when quotation is sent** | ✅ COVERED | Admin manually dispatches Magic Link via WhatsApp (`wa.me`) click and email dispatch action from the Fast-Quote console. |
| **NOTIF-04** | **Admin receives alert when customer accepts quotation** | ✅ COVERED | Real-time high-priority alert badge + automated transactional email to admin inbox with accepted quotation details. |
| **NOTIF-05** | **Customer receives bank wire / proforma details after acceptance** | ✅ COVERED | Customer milestone banner on Magic Link page shows wire transfer instructions immediately after acceptance. |
| **NOTIF-06** | **Customer receives notification when quotation is about to expire** | ❌ MISSING | The admin dashboard shows an *"Expiring Soon"* tab, but the PRD does not define whether the **customer** receives a notification (email or WhatsApp) warning them that their quotation will expire in X days. This is a key commercial reminder. |
| **NOTIF-07** | **Customer receives notification when their 5-day payment reservation expires** | ❌ MISSING | When the 5-day stock reservation expires without payment, the quotation moves to `Payment Expired / Stock Released`. No customer notification for this event is defined. The customer may not know their reservation was cancelled. |
| **NOTIF-08** | **Customer receives notification when RFQ is marked Need Clarification** | ✅ COVERED | Marking an RFQ `Need Clarification` sends in-app and email prompt to the buyer. |
| **NOTIF-09** | **Admin receives security alert on login from new IP/country** | ✅ COVERED | Real-time email alert dispatched on every admin login; high-severity alert for new/foreign IP. |
| **NOTIF-10** | **Admin receives alert when brute-force lockout triggers** | ✅ COVERED | 5 failed attempts → 15-minute IP lockout + automated security warning email to owner. |
| **NOTIF-11** | **Admin receives alert when recovery code is consumed** | ✅ COVERED | Consuming a backup recovery code triggers an emergency alert email to the owner. |
| **NOTIF-12** | **Customer receives notification when a revision (v2) is issued** | ⚠️ PARTIAL | PRD says admin generates a new Magic Link for `v2` and sends it. But it's not clear whether this is **automatic system dispatch** (email auto-sent) or a **manual action** (admin copies and pastes into WhatsApp). The notification mechanism for revision delivery is not formally specified. |
| **NOTIF-13** | **Admin receives alert for email delivery failures** | ✅ COVERED | Failures logged to `NOTIFICATION_LOG`; available for manual admin inspection. Auto-retry is implied but retry count/interval is not defined. |
| **NOTIF-14** | **Customer receives order dispatch notification with AWB tracking** | ❌ MISSING | When admin clicks `Mark Dispatched` and enters courier + AWB number, the PRD does not define whether the customer is automatically notified with the tracking details. This is a key customer experience event. |
| **NOTIF-15** | **Customer receives delivery confirmation notification** | ❌ MISSING | When admin clicks `Mark Delivered`, no customer notification is defined. The customer may never know their order is marked as delivered in the system unless they contact admin directly. |
| **NOTIF-16** | **Admin receives daily summary of pending/expiring items** | ❌ MISSING | No daily digest or batch summary notification is defined for the admin — pending RFQs, quotes expiring today, reservations expiring today. This would be operationally critical for a single-operator business. |

---

## 8. 🚨 Exception Handling

Situations outside the normal happy path that the system must handle without crashing or corrupting data.

| ID | Exception Scenario | Status | Details & Required Spec |
| :--- | :--- | :--- | :--- |
| **EX-01** | **Database write fails during RFQ save** | ⚠️ PARTIAL | PRD defines that email failure must not roll back RFQ records. But it does not define the inverse — what happens if the DB save itself fails (e.g., DB connection timeout)? Does the buyer see an error? Is there a retry? |
| **EX-02** | **PDF generation fails at quotation issuance** | ❌ MISSING | No exception handling defined if the server-side PDF renderer fails. The admin may not know the PDF was not generated, and the customer would receive a Magic Link to a quotation with no downloadable PDF. |
| **EX-03** | **Email service (SMTP/SendGrid) is fully down** | ⚠️ PARTIAL | PRD says failures are logged. But if the email provider goes down for hours (e.g., during peak China business hours), there is no defined: (a) retry schedule, (b) fallback channel (WhatsApp manual instructions), (c) admin alert threshold. |
| **EX-04** | **CDN edge node failure (global CDN or Near-China node)** | ⚠️ PARTIAL | PRD mentions uptime monitoring with admin SMS/email alerts. But no specific failover or multi-CDN fallback strategy is defined in case of edge node downtime, especially for the critical China-facing near-CDN edge. |
| **EX-05** | **Concurrent Accept clicks from same Magic Link on two devices** | ❌ MISSING | Buyer clicks `Accept` on both their phone and laptop simultaneously. The system must handle this race condition atomically — the quotation should transition to `Accepted` exactly once. Database-level transaction locking strategy is not defined. |
| **EX-06** | **FX rate API returns corrupt or out-of-range data** | ❌ MISSING | If the live FX rate API returns a nonsensical value (e.g., 1 USD = 0.001 BDT due to a bug), the Fast-Quote Engine would produce incorrect prices. No validation/sanity check on incoming FX rate data is defined. |
| **EX-07** | **Prescription file stored but encryption service unavailable** | ❌ MISSING | If the AES-256 encryption service or key management system is unavailable at the time of prescription upload, should the upload be blocked entirely, or stored unencrypted temporarily? This exception must be defined. |
| **EX-08** | **CSV Bulk Import file is malformed (non-UTF8, corrupted)** | ⚠️ PARTIAL | PRD mentions validation and error highlighting but doesn't define what happens if the file itself is corrupted, in an unexpected encoding, or not a valid CSV at all. |
| **EX-09** | **Admin clicks `Mark Dispatched` without entering AWB** | ⚠️ PARTIAL | PRD says admin logs courier name and AWB tracking number during dispatch. But it's not specified whether AWB is mandatory or optional. If AWB is optional and admin skips it, the customer has no tracking reference. |
| **EX-10** | **Stock reservation timer service fails (cron job crash)** | ❌ MISSING | The 5-day stock reservation expiry is time-based (automated check on `reservation_expires_at`). If the background timer/cron job that checks and expires reservations fails or crashes, reservations would remain active indefinitely. No monitoring or alerting for this background job failure is defined. |
| **EX-11** | **Admin deletes a draft quotation that is already in the buyer's browser** | ❌ MISSING | If a draft quotation's Magic Link was sent prematurely and the admin then deletes or overwrites it, the buyer who opens the old link would hit an error state. The PRD doesn't define this token invalidation flow. |
| **EX-12** | **Platform detects pricing data in a public API response** | ⚠️ PARTIAL | PRD defines this as an acceptance criterion (zero pricing leakage). But no automated continuous monitoring or alerting is defined to detect if a future code change accidentally exposes pricing data in production. |

---

## 9. 📊 Summary Scorecard

| Category | ✅ Covered | ⚠️ Partial | ❌ Missing | Total Items |
| :--- | :---: | :---: | :---: | :---: |
| **Missing Flows** | 0 | 3 | 7 | **10** |
| **Edge Cases** | 0 | 5 | 7 | **12** |
| **Error Handling** | 4 | 5 | 3 | **12** |
| **Security** | 8 | 4 | 2 | **14** |
| **Validation** | 3 | 7 | 3 | **13** |
| **Permission** | 7 | 2 | 4 | **13** |
| **Notification** | 8 | 2 | 6 | **16** |
| **Exception** | 0 | 5 | 7 | **12** |
| **TOTAL** | **30** | **33** | **39** | **102** |

---

## 10. 🔥 Priority Action List (Must Resolve Before Engineering Starts)

> [!CAUTION]
> The following items are **HIGH severity** gaps that could cause data corruption, security breaches, or broken user experiences if not addressed before development begins.

| Priority | ID | Category | Issue |
| :---: | :--- | :--- | :--- |
| 🔴 P1 | **SEC-05** | Security | Magic Link forwarding attack — no mitigation for unauthorized acceptance. Recommend IP logging + access alert. |
| 🔴 P1 | **EX-05** | Exception | Concurrent Accept race condition — must define atomic DB transaction locking strategy. |
| 🔴 P1 | **MF-06** | Missing Flow | ✅ **RESOLVED & COVERED** — Specced in PRD.md Section 3.2. Partial quote with item availability status and customer notes. |
| 🔴 P1 | **EH-07** | Error Handling | DB write failure on Accept action — rollback/retry strategy completely missing. |
| 🔴 P1 | **MF-10** | Missing Flow | Email delivery failure fallback — no retry schedule or admin alert threshold defined. |
| 🟠 P2 | **NOTIF-14** | Notification | Customer not notified when order is dispatched (AWB tracking not auto-sent). |
| 🟠 P2 | **NOTIF-15** | Notification | Customer not notified when order is marked delivered. |
| 🟠 P2 | **NOTIF-06** | Notification | No expiry reminder sent to customer before quotation expires. |
| 🟠 P2 | **NOTIF-07** | Notification | No customer alert when 5-day payment reservation is cancelled. |
| 🟠 P2 | **EX-10** | Exception | Stock reservation cron job failure — no monitoring/alert if the timer service crashes. |
| 🟠 P2 | **MF-09** | Missing Flow | ✅ **RESOLVED & COVERED** — Specced in PRD.md Section 3.3. Terminal Closed state with reason & automated email. |
| 🟡 P3 | **VAL-05** | Validation | Phone/WhatsApp number format validation rules not defined. |
| 🟡 P3 | **VAL-07** | Validation | Markup % field has no min/max range validation. |
| 🟡 P3 | **VAL-08** | Validation | Quotation validity date not prevented from being set in the past. |
| 🟡 P3 | **SEC-10** | Security | CSRF protection on form submissions not mentioned. |
| 🟡 P3 | **PERM-13** | Permission | No cancellation flow defined for an Accepted quotation. |