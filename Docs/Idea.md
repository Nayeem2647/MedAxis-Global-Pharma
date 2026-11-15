MedAxis Global Pharma business-er main workflow hobe:
Product information → Customer inquiry → Quotation → Customer confirmation → Sourcing → Payment verification → Delivery → Follow-up.
Website-er kaj hobe customer-er requirement collect kora, quotation manage kora, ar tomar team-ke protita kajer status o responsibility clear kore dewa.
Nicher workflow developer ba AI-ke diye website-er requirements, database, dashboard ebong development plan toiri kora jabe.
MedAxis Global Pharma Business and Website Workflow
1. Business model and working assumptions
Business model: Bangladesh-based pharmaceutical sourcing and quotation business.
Tomra different manufacturer/supplier-er product catalogue maintain korba. Customer product select kore requirement dibe. Tomar sales team availability o purchase cost verify kore customer-specific quotation dibe.
Confirmed requirements:
•	Public website-e product price thakbe na.
•	Single-product ebong multiple-product quotation thakbe.
•	Quotation submit korar jonno account lagbe.
•	Wholesale buyer ebong patient—dui dhoroner customer thakbe.
•	Product manufacturer, generic ebong category diye search kora jabe.
•	Quotation-er revision history thakbe.
•	Customer shudhu nijer quotation dekhte parbe.
•	COA request, comparison ebong product-related blog planned feature.
•	Dashboard theke product, inquiry, quotation, customer ebong content manage kora jabe.
•	Prothome online payment gateway thakbe na.
Ei workflow-er proposed assumptions:
•	A1: Attached notes onujayi global customer support thakbe; China customer-er jonno Chinese experience thakbe.
•	A2: Customer-facing language English ebong Simplified Chinese. Manual language choice save thakbe; China visitor-er initial language Chinese, others English. Country detect na hole English fallback.
•	A3: Order confirmation-er por payment verification, procurement ebong shipment prothome staff manually update korbe.
•	A4: Website full accounting/ERP replace korbe na; quotation theke delivery porjonto basic tracking korbe.
•	A5: Patient request-er prescription review process business owner define korbe. Patient request initially inquiry hisebe collect hobe; inquiry submit mane supply approval na.
Ei assumption-gulo final business decision hisebe dhore development kora jabe na; scope confirmation-er shomoy approve korte hobe.
2. Ke kon kaj korbe
Egulo system role; protita role-er jonno alada employee lagbei emon na.
Business Owner / Super Admin
Settings, permissions, commercial approval, overall reporting
Inquiry review, customer communication, quotation, follow-up
Supplier availability, purchase cost, procurement, shipment coordination 
Product search, RFQ submit, quotation review, revision, document request
Product information, manufacturer, category, blog, banner
Payment receipt verify, refund/payment issue record
COA/document check ebong release

3. Business start korar age setup
Website launch-er age admin-ke ei master information ready korte hobe:
1.	Company profile ebong verified contact details.
2.	Manufacturer ebong supplier list.
3.	Generic name list.
4.	Therapeutic category list.
5.	Product catalogue.
6.	Quotation-er currency, quantity unit ebong validity rules.
7.	Sales assignment ebong quotation approval rules.
8.	Confirmed service ebong delivery destination list.
9.	Email templates ebong quotation PDF template.
10.	Staff account ebong permissions.
Manufacturer ar supplier alada record hobe. Manufacturer product toiri kore; supplier holo jar theke tomra product purchase koro. Ek product-er multiple supplier thakte pare.

4. Product onboarding workflow
Admin publish korbe.
Protita product record-e thakbe:
•	Product ID/SKU
•	Brand name
•	Generic name
•	Strength
•	Dosage form
•	Pack size
•	Manufacturer
•	Therapeutic category
•	Product image
•	Indication summary
•	Storage information
•	Availability information
•	Related products
•	Last updated date
•	English/Chinese content, jekhane available
Proposed publishing status: Draft → Review → Published → Archived.
Important system rules:
•	Published product-er public price thakbe na.
•	Archived product notun search result-e show korbe na, kintu purono quotation history-te thakbe.
•	Catalogue change korle previously sent quotation-er product description ba price change hobe na.
•	Related product mane medical replacement recommendation na.
•	Customer-facing availability ebong supplier-confirmed availability alada information hobe.
•	
5. Customer website-e dhukle ki dekhbe
Page structure:
1.	Top bar: Phone, email, social links, Login, Register.
2.	Announcement bar: Admin-er published message.
3.	Navigation: Home, Products, Services, Blog, About Us, Contact.
4.	Header actions: Search, language switcher, quotation list, account.
5.	Homepage: Banner, therapeutic categories, featured/new products, delivery-country map.
6.	Main buttons: Find Products, Request a Quotation, Submit Bulk Requirement.

6. Product search and selection
Customer search korte parbe:
•	Brand name
•	Generic name
•	Manufacturer
•	Therapeutic category
Product page-e details dekhar por customer:
•	Add to Quotation
•	View related products
•	Contact sales
use korte parbe.
Porer phase-e:
•	Compare Products
•	Save Product
•	Request COA
•	Related Blog
add hobe.
Search result na pele: “Send your requirement” option thakbe—eta proposed addition. Customer manually product-er naam o quantity dite parbe; team pore catalogue match korbe.

7. Quotation list workflow
Customer ekta ba multiple product quotation list-e add korbe.
Protita line-e thakbe:
Field	Rule
Product/brand name	Required
Generic name	Required
Pack size	Required
Required quantity	Required, positive value
Quantity unit	Required and clearly visible
Strength, dosage form, manufacturer	Catalogue-e thakle auto-fill
Required delivery date	Optional
Customer note	Optional
Customer quantity edit, item remove ebong aro product add korte parbe.
Important: “10” quantity sufficient na—“10 boxes” ba “10 bottles” hote hobe. Catalogue-er pack size ebong quotation-er pricing unit consistent thakte hobe.
Login-er age list toiri kora jabe. Submit-er shomoy login/register korte hobe; login-er por list harabe na.
8. Registration and customer profile
Customer type select korbe:
•	Wholesale / Business
•	Patient
Business buyer-er company name thakbe; patient-er jonno company name required hobe na.
Basic fields:
•	Full name
•	Email
•	Country
•	Phone/WhatsApp
•	Password
•	Spam protection
Login/register page-e configured WhatsApp ebong WeChat QR thakbe.
Proposed technical requirements: Email verification, password reset, duplicate account handling ebong login rate limit.

Prescription upload: Patient jokhon quotation pathabe tokhon patient quotation er sathe upload prescription option thkbe prescription upload na korleo quotation pathate perbe.

9. RFQ submission workflow
RFQ = Request for Quotation.
Customer quotation list confirm kore ei information dibe:
•	User type
•	Contact details
•	Company name, applicable hole
•	Destination country
•	Destination city/port
•	Required products
•	Quantity ebong unit
•	Preferred currency
•	Required documents
•	Required delivery date
•	Additional message
•	Optional attachment
Submit-er por:
1.	Request save korbe.
2.	Unique RFQ number generate korbe.
3.	Customer confirmation dekhbe.
4.	Confirmation email pathanor attempt hobe.
5.	Admin dashboard-e new request ashbe.
Failure handling:
•	Required field missing hole clear error dekhabe na.
•	Upload fail hole successful attachment dekhabe na.
•	Double-click/retry-er karone duplicate RFQ create hobe na.
•	Email fail korleo saved RFQ harabe na.
•	
10. Inquiry review and sales assignment
New RFQ → Admin assignment → Sales review.
Sales check korbe:
•	Product identification clear ki na
•	Strength/pack/quantity sufficient ki na
•	Destination details ache ki na
•	Requested delivery date ache ki na
•	Document requirement ache ki na
•	Patient-specific review lagbe ki na
Information incomplete hole status Need Clarification hobe. Customer dashboard-e question dekhbe ebong response dite parbe.
Proposed rule: Protita RFQ-er ekjon responsible sales owner thakbe. Reassignment hole history save hobe.
WhatsApp/WeChat-e discussion hole sales manually summary note record korte parbe. Full automatic chat sync first release-er requirement na.

11. Supplier and availability verification
Sales/operations supplier-er sathe check korbe:
•	Exact product ebong manufacturer
•	Available quantity
•	Purchase cost
•	MOQ
•	Lead time
•	Pack details
•	Batch/expiry, jekhane relevant ebong available
•	Document availability
•	Storage/transport requirement

Proposed addition: Multi-product RFQ-er protita line-er availability alada thakbe, jate ek item unavailable hole baki item process kora jay.

12. Quotation preparation and sending
Availability review-er por sales quotation draft korbe.
Quotation-e thakbe:
•	Quotation number ebong version
•	Related RFQ
•	Customer details
•	Product description
•	Quantity ebong unit
•	MOQ
•	Unit price
•	Line total
•	Currency
•	Shipping cost
•	Lead time
•	Payment terms
•	Delivery/shipping terms, agreed hole
•	Document availability
•	Validity date
•	Buyer-visible note
Internal note alada field-e thakbe.
Calculation rule:
Line total = Quoted quantity × Price per matching unit
Quotation total = Sum of line totals + Confirmed shipping cost
Tax/discount-er rules confirm na howa porjonto developer automatically kono tax ba discount formula add korbe na. Shipping unknown hole “To be confirmed” dekhabe; zero cost hisebe present korbe na.
Send flow:
Draft → Internal review/approval → Sent to Customer.
Approval authority configurable hobe. Sent quotation customer dashboard-e available hobe; email notification pathano hobe.
Basic PDF-te same version-er data thakbe. Internal cost/note PDF-e jabe na.

13. Revision and customer decision
Customer quotation pawar por:
•	Accept
•	Decline
•	Request Revision
•	Ask a Question
korte parbe.
Revision request-e quantity, product, delivery ba commercial requirement change korte parbe.

Version rule:
•	Original sent version overwrite hobe na.
•	Revised quotation notun version hobe.
•	Kon version accept/decline hoyeche record thakbe.
•	Old version history readable thakbe.
•	Superseded/expired version accept kora jabe na—eta proposed rule.
Quotation validity sesh hole status Expired hobe. Notun terms-e proceed korte hole revised quotation lagbe.

14. Quotation accepted howar por business operation
Ei part tomar A-to-Z business operation-er proposed workflow. Attached notes-e post-quotation details fully defined nai.
Step 1 — Internal order confirmation
Customer quotation accept korle sales:
•	Accepted version
•	Final quantity
•	Availability
•	Delivery details
•	Agreed terms
recheck korbe.
Tarpor authorized staff basic order record create korbe. Accepted quotation ar confirmed order alada status.
Step 2 — Payment instruction
Customer-ke agreed payment terms onujayi instruction/proforma invoice dewa hobe, business-e jodi applicable hoy.
Payment gateway chara payment offline hobe.

Step 3 — Payment verification
Customer payment reference/proof dite parbe—eta proposed feature.
Finance actual receipt verify korbe. Screenshot upload korlei payment “Verified” hobe na.
Possible payment status:
Pending → Under Verification → Partially Received / Verified / Issue Identified
Advance, credit ba partial payment rule business owner decide korbe.

Step 4 — Procurement
Operations supplier-er kache purchase confirm korbe, received quantity ebong product information record korbe.
Procurement kokhon start hobe—payment-er age ba pore—agreed business rule-er upor depend korbe.

Step 5 — Dispatch preparation
Team actual product, quantity, packaging, necessary documents ebong storage/transport arrangement check korbe.
Issue thakle dispatch hold thakbe; responsible staff issue resolve korbe.
Step 6 — Shipment
Shipment record-e thakbe:
•	Carrier/courier
•	Tracking reference, available hole
•	Dispatch date
•	Item ebong quantity
•	Destination
•	Shipment status
•	Relevant document
Prothome manual entry; automatic courier integration future scope.
Step 7 — Delivery and closure
Delivery confirmation pele team record update korbe. Short delivery, damage ba delay report hole issue record open korbe.
Outstanding action resolve hole order close korbe.

Website boundary: First quotation release-e eta manual operational handoff hote pare. Basic order/payment/shipment module next release-e add korar proposal; full ERP ekhane included na.

15. Customer follow-up and repeat business
Sales dashboard-e customer-er:
•	Past RFQ
•	Sent quotations
•	Accepted/declined outcome
•	Communication notes
•	Open issue
•	Follow-up date
dekha jabe.
Proposed addition: Staff manually next follow-up date set korte parbe. Automated reminder future feature hote pare.
Repeat requirement-er khetre purono product list copy kore new RFQ toiri hobe. Purono quotation price automatically valid dhora hobe na.
Decline/close-er shomoy reason record korle bujha jabe price, availability, delivery time naki onno karone opportunity lose hocche.

16. Supporting workflows
COA request
Customer product/batch select korbe → Request submit → Batch information review → Manufacturer verification → Quality/document review → Release ba Unavailable.
Rules:
•	Batch unknown hole “Batch Required”.
•	Document-er product/batch association clear thakbe.
•	Authorized reviewer release korbe.
•	Shudhu intended customer controlled access pabe.
•	System manufacturer-er COA collect/share korbe; nijer moto test result generate korbe na.
•	
Excel/CSV bulk quotation
File upload → Row preview → Missing field/error display → Suggested product match → Customer confirmation → RFQ submission.
Unmatched product silently discard ba auto-replace kora jabe na.
Product comparison
Customer maximum four products select korbe → Generic, brand, strength, form, pack, manufacturer, availability compare korbe → Quotation list-e add korbe.
Public price ba medical substitution recommendation thakbe na.
Blog
Content draft → Review → Publish → Related product link.
Blog categories: Latest Articles, Product Updates, Buyer & Export Guides.
Website content
Admin announcement, banner, service information, company profile, social links ebong confirmed delivery-country information edit/publish korbe.

17. Dashboard structure
Customer dashboard
•	Profile
•	Draft requirements
•	Submitted RFQs
•	Quotations
•	Revision requests
•	Notification/history
•	Quotation PDF
•	COA requests — module launch-er por
•	Saved products — later phase
•	Basic order/shipment status — operational module launch-er por
Staff dashboard
Module	Main actions
Overview	New requests, pending work, awaiting reply, expired quotations
Products	Create, review, publish, update, archive
Master data	Manufacturer, supplier, generic, category, quantity units
Customers	Profile, request history, assignment
RFQs	Review, clarify, assign, process
Quotations	Draft, approve, send, revise, track
Documents	Review, associate with product/batch, controlled release
Content	Banner, announcement, pages, blog, social links
Reports	Product/country demand, response time, quotation outcomes
Settings	Roles, templates, currencies, status rules
Audit log	Who changed what and when
Later operational modules: Orders, Payment Verification, Procurement, Shipments, Issues.
Staff-er screen-e only tar authorized module show korbe.

18. Developer-er jonno data structure
Nicher entity-gulo logical requirement; kon database/framework use hobe seta ekhono fixed na.
Entity	Ki store korbe
User	Login identity, contact, role
Customer Profile	User type, company, country, preferences
Manufacturer	Product manufacturing company
Product	Catalogue information
Generic / Category	Product classification
Product Translation	Language-wise approved content
RFQ	Customer requirement o responsible sales
RFQ Item	Product, quantity, unit, requested details
Quotation	Customer-specific commercial response
Quotation Version / Item	Protita version-er terms, price, quantity
Status History	State change, actor, time, comment
Document Request / Document	COA/request, file, batch, access
Notification Log	Recipient, event, sending result
Content	Announcement, banner, page, blog
Audit Event	Important staff/system change
Later phase-e Order, Payment Record, Procurement Record, Shipment ebong Issue entity add hobe.

Required relationship rules:
•	Ek customer-er multiple RFQ thakte pare.
•	Ek RFQ-te multiple item thakte pare.
•	Quotation-er multiple version thakbe.
•	Document relevant product/batch/request-er sathe linked thakbe.
•	Customer-facing history-te internal note mix hobe na.
•	Old quotation original product data-r snapshot preserve korbe.
•	
19. Status and automation rules
RFQ, quotation, order, payment ebong shipment-er status alada rakhte hobe. Ekta long status list diye shob manage korle confusion hobe.
Record	Proposed statuses
RFQ	Draft, Submitted, Received, Under Review, Need Clarification, Quoted, Closed
Quotation	Draft, Pending Approval, Sent, Revision Requested, Superseded, Accepted, Declined, Expired
Order — later module	Pending Confirmation, Confirmed, Processing, Completed, Cancelled
Payment — later module	Pending, Under Verification, Partially Received, Verified, Issue Identified
Shipment — later module	Preparing, Dispatched, In Transit, Delivered, Exception
Automatic actions:
•	RFQ submit → reference number, dashboard entry, confirmation email attempt.
•	Quotation send → exact version customer workspace-e available.
•	Revision send → previous version history-te preserve.
•	Validity end → applicable quotation expire.
•	Important change → timestamp ebong actor log.
•	Email fail → failure log; main business record intact.
Manual actions:
•	Availability verification
•	Price approval
•	Payment verification
•	Document review
•	Dispatch confirmation
Ei action-guloke system nijer moto completed mark korbe na.
20. Development order and release scope
Release	Ki build korbe	Completion condition
Release 1 — Quotation business	Basic public pages/CMS, catalogue, search, account, quotation list, single/manual bulk RFQ, sales assignment, private quotation, revision, PDF, status, email, permissions	Customer request theke quotation decision porjonto flow complete
Release 2 — Customer support features	COA, Excel/CSV upload, comparison, blog, saved products	Protita feature own access ebong error handling-shoho kaj kore
Release 3 — Operational tracking	Basic order, payment verification, procurement, shipment, issue tracking	Accepted quotation theke delivery/closure record maintain kora jay
Release 4 — Integrations	CRM, automated messaging, courier/ERP integration jodi approved hoy	Selected external system-er sathe verified data exchange
Release decision pending: English/Chinese translation ebong automatic country-based language detection Release 1-e thakbe ki na. China-ke primary launch market dhorle eta launch scope-e rakhar proposal.

21. Build complete bolar age ja test korte hobe
1.	Customer product search kore correct result pabe.
2.	Public visitor kono price pabe na.
3.	Multiple product quantity/unit-shoho RFQ submit hobe.
4.	Login-er por quotation list preserve thakbe.
5.	Duplicate submission control kaj korbe.
6.	Assigned sales request review korte parbe.
7.	Admin/customer quotation-er quantity, price, currency ebong totals match korbe.
8.	Revision purono quotation overwrite korbe na.
9.	Customer A, Customer B-er quotation/document access korte parbe na.
10.	Internal note/cost public response, email ba PDF-e jabe na.
11.	Email failure record hobe.
12.	Mobile-e complete journey kaj korbe.
13.	Invalid input ebong failed upload clear error dekhabe.
14.	Dashboard-er count actual record-er sathe match korbe.
15.	Backup restore test pass korbe.
16.	Language feature scope-e thakle manual preference ebong fallback test pass korbe.
Performance target, supported file size ebong expected traffic final scope-er age define korte hobe.

22. Developer ba AI-ke dewar build instruction
Nicher instruction-er sathe upor-er complete workflow attach korba:
Build MedAxis Global Pharma using the attached business workflow as the source of truth.
Start with Release 1. Keep later-phase features in the development plan unless explicitly approved for the first release.
Create three experiences: public website, customer dashboard, and permission-controlled staff dashboard.
The core journey is product discovery → quotation list → account login → RFQ submission → sales review → availability verification → private quotation → revision → customer decision.
Do not expose product prices publicly. Keep customer quotations, internal costs, internal notes, and private documents access-controlled.
Preserve quotation versions and historical product details. Treat RFQ, quotation, order, payment, and shipment as separate records with separate statuses.
Before implementation, produce:
1.	Page and navigation list.
2.	User flows and screen states.
3.	Role and permission matrix.
4.	Logical data model.
5.	Status transition rules.
6.	Feature-by-feature implementation tasks.
7.	Acceptance tests mapped to the workflow.
Label unresolved business rules as assumptions. Do not invent product information, certifications, delivery coverage, prices, payment terms, or operational capabilities.
If a screen is a prototype, clearly label demo data and inactive integrations. Do not present sample metrics as live business results.
Select and explain the technical stack separately; do not treat an unapproved stack, provider, cost, or delivery timeline as a confirmed requirement.
Build start-er age tomar final decision lagbe: brand/domain, global vs China launch, patient prescription process, launch languages, quotation approval authority, payment terms, delivery destinations ebong Release 1-er exact feature list. Ei decision-gulo pele developer-er jonno scope ebong workflow duita-i clear thakbe.

