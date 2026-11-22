export type ServiceLang = 'en' | 'zh';

export type ServiceId =
  | 'cold-chain'
  | 'sourcing'
  | 'coa-support'
  | 'emergency-delivery'
  | 'bulk-order';

export interface ServiceBlockCopy {
  id: ServiceId;
  aliasId?: string;
  stepCode: string;
  eyebrow: string;
  title: string;
  summary: string;
  highlights: readonly [string, string, string];
  primaryActionLabel?: string;
  secondaryLinkLabel?: string;
  quoteActionLabel: string;
}

export interface ServicesCopy {
  langToggleLabel: string;
  breadcrumbHome: string;
  breadcrumbServices: string;
  breadcrumbSourcing: string;
  hero: {
    badge: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
    detailBadge?: string;
    detailSubtitle?: string;
    laneHeader: string;
    laneRoute: string;
    laneStatus: string;
    tempMetricLabel: string;
    tempMetricValue: string;
    dispatchMetricLabel: string;
    dispatchMetricValue: string;
    trustBadges: readonly [string, string, string];
  };
  tabs: ReadonlyArray<{ id: ServiceId; label: string }>;
  tabsAriaLabel: string;
  services: ReadonlyArray<ServiceBlockCopy>;
  visuals: {
    coldChain: {
      title: string;
      statusStable: string;
      modeRefrigerated: string;
      modeFrozen: string;
      currentTempLabel: string;
      rangeLabel: string;
      refrigeratedRange: string;
      frozenRange: string;
      loggerLabel: string;
      loggerValue: string;
      holdTimeLabel: string;
      holdTimeValue: string;
      excursionLabel: string;
      excursionValue: string;
      probeReadout: string;
    };
    sourcing: {
      title: string;
      subtitle: string;
      badges: readonly [string, string, string];
      batches: ReadonlyArray<{
        molecule: string;
        strength: string;
        batchCode: string;
        expiry: string;
        facility: string;
      }>;
      traceabilityLabel: string;
      traceabilityValue: string;
    };
    coaSupport: {
      title: string;
      subtitle: string;
      badges: readonly [string, string, string];
      documents: ReadonlyArray<{
        code: string;
        name: string;
        status: string;
      }>;
      dossierNote: string;
    };
    emergencyDelivery: {
      title: string;
      carrierLabel: string;
      priorityCode: string;
      stages: ReadonlyArray<{
        title: string;
        timing: string;
        detail: string;
      }>;
      clearanceNote: string;
    };
    bulkOrder: {
      title: string;
      subtitle: string;
      tiers: ReadonlyArray<{
        segment: string;
        scope: string;
        benefit: string;
      }>;
      consolidationLabel: string;
      consolidationValue: string;
    };
  };
  workflow: {
    eyebrow: string;
    title: string;
    subtitle: string;
    steps: ReadonlyArray<{
      number: string;
      title: string;
      description: string;
    }>;
  };
  faq: {
    eyebrow: string;
    title: string;
    subtitle: string;
    items: ReadonlyArray<{
      question: string;
      answer: string;
    }>;
  };
  bottomCta: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta: string;
    secondaryCta: string;
  };
  coaModal: {
    title: string;
    subtitle: string;
    watermark: string;
    docNumberLabel: string;
    docNumber: string;
    productLabel: string;
    productValue: string;
    batchLabel: string;
    batchValue: string;
    mfgDateLabel: string;
    mfgDateValue: string;
    expDateLabel: string;
    expDateValue: string;
    originLabel: string;
    originValue: string;
    storageLabel: string;
    storageValue: string;
    tableHeaders: readonly [string, string, string, string];
    rows: ReadonlyArray<readonly [string, string, string, string]>;
    qaSignOffLabel: string;
    qaSignOffValue: string;
    disclaimer: string;
    printAction: string;
    requestVerifiedCta: string;
    close: string;
  };
  quoteModal: {
    title: string;
    subtitle: string;
    companyLabel: string;
    companyPlaceholder: string;
    contactPersonLabel: string;
    contactPersonPlaceholder: string;
    channelLabel: string;
    channelPlaceholder: string;
    serviceTypeLabel: string;
    medicineLabel: string;
    medicinePlaceholder: string;
    destinationLabel: string;
    destinationPlaceholder: string;
    submitLabel: string;
    submittingLabel: string;
    close: string;
    securityNote: string;
    fullRfqLink: string;
    validationSummary: string;
    requiredField: string;
    invalidChannel: string;
    successTitle: string;
    successSubtitle: string;
    referenceLabel: string;
    summaryHeading: string;
    whatsAppFallback: string;
    submitAnother: string;
    countries: ReadonlyArray<{ code: string; label: string }>;
  };
}

export const SERVICES_COPY: Record<ServiceLang, ServicesCopy> = {
  en: {
    langToggleLabel: 'Page language',
    breadcrumbHome: 'Home',
    breadcrumbServices: 'Services',
    breadcrumbSourcing: 'Global Pharma Sourcing',
    hero: {
      badge: 'GLOBAL PHARMA LOGISTICS & COMPLIANCE',
      title: 'End-to-End Pharmaceutical Supply Chain & Export Solutions',
      subtitle:
        'Specialized cold-chain logistics, direct manufacturer sourcing, and batch-verified CoA documentation for oncology and critical care medicines worldwide.',
      primaryCta: 'Request Quick Quote',
      secondaryCta: 'Explore Services',
      detailBadge: 'DIRECT MANUFACTURER SOURCING',
      detailSubtitle:
        'Direct wholesale and named-patient oncology sourcing from licensed WHO-GMP, EU-GMP, and DGDA manufacturers with validated export compliance.',
      laneHeader: 'ACTIVE EXPORT LANE',
      laneRoute: 'DAC (Dhaka) -> HKG / SIN / DXB / PVG',
      laneStatus: 'Pre-Cleared Corridor',
      tempMetricLabel: 'Live Thermal Range',
      tempMetricValue: '4.2°C Stable',
      dispatchMetricLabel: 'Express SLA',
      dispatchMetricValue: '48–72 Hours',
      trustBadges: ['2°C–8°C Certified', '100% Batch CoA Verified', '48–72h Express Dispatch'],
    },
    tabsAriaLabel: 'Pharmaceutical services sections',
    tabs: [
      { id: 'cold-chain', label: 'Cold-Chain Logistics' },
      { id: 'sourcing', label: 'Global Pharma Sourcing' },
      { id: 'coa-support', label: 'Compliance & CoA Support' },
      { id: 'emergency-delivery', label: 'Emergency Drug Delivery' },
      { id: 'bulk-order', label: 'Bulk Order Fulfillment' },
    ],
    services: [
      {
        id: 'cold-chain',
        stepCode: '01',
        eyebrow: 'COLD-CHAIN LOGISTICS',
        title: 'Validated Biologics & Oncology Cold-Chain Transport',
        summary:
          'Maintain unbroken potency from manufacturer vault to clinical receiving dock with GDP-aligned thermal engineering and continuous telemetry.',
        highlights: [
          'Validated 2°C to 8°C (refrigerated) and -20°C (frozen) temperature-controlled packaging for biologics and oncology injectables.',
          'Active & passive thermal insulated boxes with phase-change gel packs.',
          '24/7 digital USB/cloud temperature data loggers included in every shipment.',
        ],
        quoteActionLabel: 'Quote Cold-Chain Dispatch',
      },
      {
        id: 'sourcing',
        stepCode: '02',
        eyebrow: 'GLOBAL PHARMA SOURCING',
        title: 'Direct Licensed Manufacturer Procurement & Batch Traceability',
        summary:
          'Eliminate intermediary risk through vetted oncology and critical-care factories with verified batch release dossiers and long remaining expiry.',
        highlights: [
          'Direct procurement from WHO-GMP, EU-GMP, and US-FDA approved pharmaceutical manufacturers.',
          'Specialized sourcing for rare, hard-to-find, and newly approved oncology & targeted therapy generics (e.g., Osimertinib, Lorlatinib).',
          'Strict batch traceability and long shelf-life guarantee (minimum 18–24 months expiry).',
        ],
        secondaryLinkLabel: 'View Bangladesh Sourcing Overview',
        quoteActionLabel: 'Request Sourcing Availability',
      },
      {
        id: 'coa-support',
        aliasId: 'compliance',
        stepCode: '03',
        eyebrow: 'COMPLIANCE & COA SUPPORT',
        title: 'Batch-Specific CoA, MSDS & Customs Import Dossiers',
        summary:
          'Every shipment travels with authenticated factory analytical reports and destination-checked clearance paperwork to avoid customs holds.',
        highlights: [
          'Batch-specific Certificate of Analysis (CoA), Material Safety Data Sheet (MSDS), and Certificate of Origin (CoO).',
          'Complete export customs documentation, airway bill pre-alerts, and regulatory import permit guidance.',
          'Pre-dispatch digital dossier inspection so hospital QA teams can sign off before air uplifts.',
        ],
        primaryActionLabel: 'Preview Sample CoA',
        quoteActionLabel: 'Request Documentation Check',
      },
      {
        id: 'emergency-delivery',
        aliasId: 'delivery',
        stepCode: '04',
        eyebrow: 'EMERGENCY DRUG DELIVERY',
        title: 'Priority 48–72h Critical Care Air-Freight Corridor',
        summary:
          'When inpatient therapy cannot wait for sea consolidation, our priority air desk dispatches verified treatment regimens under strict customs pre-alerts.',
        highlights: [
          'Priority medical express air-freight via DHL Medical Express, FedEx Priority, and specialized pharma couriers.',
          'Rapid 48–72 hour international dispatch for urgent patient-named and hospital critical care orders.',
          'Dedicated customs pre-clearance team to prevent port delays.',
        ],
        quoteActionLabel: 'Book Priority Dispatch',
      },
      {
        id: 'bulk-order',
        aliasId: 'bulk',
        stepCode: '05',
        eyebrow: 'BULK ORDER FULFILLMENT',
        title: 'Institutional Wholesale Allocation & Multi-SKU Consolidation',
        summary:
          'Structured contract pricing, tamper-evident export master cartons, and continuous quarterly forecasting for hospitals and regional importers.',
        highlights: [
          'Tiered wholesale pricing and volume discounts for hospitals, oncology clinics, NGOs, and regional distributors.',
          'Consolidated multi-SKU shipments with tamper-evident export master cartons.',
          'Dedicated B2B Account Manager for recurring quarterly/monthly supply contracts.',
        ],
        primaryActionLabel: 'Request Bulk Quote',
        quoteActionLabel: 'Discuss Contract Terms',
      },
    ],
    visuals: {
      coldChain: {
        title: 'Thermal Telemetry Monitor',
        statusStable: '4.2°C Stable',
        modeRefrigerated: '2°C–8°C Biologics',
        modeFrozen: '-20°C Frozen Cryo',
        currentTempLabel: 'Chamber Probe CH-01',
        rangeLabel: 'Validated Envelope',
        refrigeratedRange: '2.0°C – 8.0°C',
        frozenRange: '-22.0°C – -18.0°C',
        loggerLabel: 'Data Logger',
        loggerValue: 'USB + Cloud (24/7)',
        holdTimeLabel: 'Qualified Hold Time',
        holdTimeValue: '120 Hours Passive',
        excursionLabel: 'Thermal Excursion',
        excursionValue: '0 Alerts • Compliant',
        probeReadout: 'Active logger telemetry • Sample lane monitoring',
      },
      sourcing: {
        title: 'Batch Provenance & Manufacturer Audit',
        subtitle: 'Authenticated factory lot traceability',
        badges: ['WHO-GMP', 'EU-GMP', 'US-FDA Listed'],
        batches: [
          {
            molecule: 'Osimertinib 80mg Tablets',
            strength: 'Targeted EGFR-TKI • 30s Bottle',
            batchCode: 'LOT #OS-2604A',
            expiry: 'Exp: 23 Months',
            facility: 'Licensed Oncology Unit I',
          },
          {
            molecule: 'Lorlatinib 100mg Film Tablets',
            strength: 'ALK Inhibitor • Blister Pack',
            batchCode: 'LOT #LR-2602B',
            expiry: 'Exp: 24 Months',
            facility: 'Licensed Oncology Unit II',
          },
        ],
        traceabilityLabel: 'Minimum Remaining Shelf-Life',
        traceabilityValue: '18–24 Months Guaranteed',
      },
      coaSupport: {
        title: 'Export Dossier Readiness',
        subtitle: 'Pre-clearance packet verified prior to handoff',
        badges: ['CoA Verified', 'GMP Certified', 'Customs Cleared'],
        documents: [
          { code: 'COA', name: 'Batch Certificate of Analysis (HPLC & Dissolution)', status: 'Signed QA' },
          { code: 'MSDS', name: '16-Section Material Safety Data Sheet', status: 'Verified' },
          { code: 'COO', name: 'Chamber-Endorsed Certificate of Origin', status: 'Ready' },
          { code: 'AWB', name: 'Pre-Alert Airway Bill & Packing List', status: 'Transmitted' },
        ],
        dossierNote: 'Digital PDF + Stamped Hardcopy Pouch Included',
      },
      emergencyDelivery: {
        title: 'Priority Express Transit Timeline',
        carrierLabel: 'DHL Medical Express / FedEx Priority',
        priorityCode: 'SLA: 48–72H',
        stages: [
          { title: 'Order Confirmed', timing: 'T + 0h', detail: 'Batch locked & QA dossier matched' },
          { title: 'Cold-Packed (6h)', timing: 'T + 6h', detail: 'Phase-change gel + USB logger sealed' },
          { title: 'Air Transit', timing: 'T + 18h', detail: 'Uplift on priority medical cargo flight' },
          { title: 'Delivered', timing: 'T + 48–72h', detail: 'Pre-cleared dock / clinical handover' },
        ],
        clearanceNote: 'Dedicated customs broker pre-files documents before flight arrival.',
      },
      bulkOrder: {
        title: 'Wholesale Program & Carton Matrix',
        subtitle: 'Engineered for high-volume institutional procurement',
        tiers: [
          { segment: 'Hospital & Oncology Centers', scope: '50 – 500 Packs / Order', benefit: 'Institutional SLA + Batch Reservation' },
          { segment: 'Regional Distributors', scope: '500 – 5,000+ Packs', benefit: 'Tiered Volume Rebates + Mixed SKUs' },
          { segment: 'NGO & Humanitarian Tenders', scope: 'Multi-Lot Contracts', benefit: 'Master Export Crating + Dedicated Ops' },
        ],
        consolidationLabel: 'Export Master Carton Security',
        consolidationValue: 'Tamper-Evident Seals + Multi-SKU Manifest',
      },
    },
    workflow: {
      eyebrow: 'HOW IT WORKS',
      title: 'Structured 4-Step Pharmaceutical Export Workflow',
      subtitle: 'Built for procurement managers, clinical pharmacists, and wholesale buyers seeking predictability.',
      steps: [
        {
          number: '01',
          title: 'Submit Generic / SKU List',
          description: 'Share generic molecules, strengths, quantities, and destination port requirements.',
        },
        {
          number: '02',
          title: 'Proforma Quote & CoA Verification',
          description: 'Receive confidential pricing, batch expiry windows, and sample factory CoA dossiers.',
        },
        {
          number: '03',
          title: 'Cold-Chain Packing & Export Docs',
          description: 'GDP-compliant thermal conditioning, tamper-evident master cartons, and customs paperwork.',
        },
        {
          number: '04',
          title: 'Express Air Dispatch & Live Tracking',
          description: 'Priority uplift via DHL Medical Express / FedEx with digital logger readout upon arrival.',
        },
      ],
    },
    faq: {
      eyebrow: 'FREQUENTLY ASKED QUESTIONS',
      title: 'B2B Export, Cold-Chain & Documentation FAQ',
      subtitle: 'Clear operational answers for hospital procurement teams, regional distributors, and clinical coordinators.',
      items: [
        {
          question: 'How do you guarantee temperature stability during long-haul flights?',
          answer:
            'Every temperature-sensitive biologic or oncology injectable is packed in pre-qualified passive or active vacuum-insulated shippers with conditioned phase-change gel packs rated for up to 120 hours, accompanied by a calibrated USB/cloud data logger recording every 5 minutes.',
        },
        {
          question: 'Can we verify the batch CoA before making payment?',
          answer:
            'Yes. Once we confirm stock allocation for your target batch, our regulatory desk provides redacted batch-specific CoA, expiry verification, and manufacturing license documentation during the Proforma Invoice stage prior to settlement.',
        },
        {
          question: 'What documents are provided for customs clearance in China, Asia, or the Middle East?',
          answer:
            'Standard export sets include Commercial Invoice, Detailed Packing List, Batch-Specific CoA, MSDS, Certificate of Origin (CoO), Proforma/Airway Bill pre-alerts, and destination-specific named-patient or institutional import support letters.',
        },
        {
          question: 'What is the minimum order quantity (MOQ) for wholesale vs. emergency orders?',
          answer:
            'Named-patient and emergency critical care dispatches have no high MOQ — single-course therapy packs ship via priority express. B2B wholesale tier discounts begin on multi-carton institutional and distributor volumes tailored per molecule.',
        },
      ],
    },
    bottomCta: {
      eyebrow: 'BESPOKE EXPORT COORDINATION',
      title: 'Need a Custom Logistics or Bulk Pharmaceutical Sourcing Plan?',
      subtitle:
        'Connect directly with our international sourcing and cold-chain operations specialists for private quotations within 4 business hours.',
      primaryCta: 'Request Quick Quote',
      secondaryCta: 'Browse Catalog',
    },
    coaModal: {
      title: 'Verified Batch Certificate of Analysis (Sample)',
      subtitle: 'Representative format issued prior to shipment release. Actual buyer CoAs match shipped manufacturer batch lots.',
      watermark: 'MedAxis Global Pharma - Verified Batch CoA',
      docNumberLabel: 'Document Ref',
      docNumber: 'COA-MX-2026-0418-SAMPLE',
      productLabel: 'Product / Generic',
      productValue: 'Osimertinib Mesylate Tablets 80 mg (Film-Coated)',
      batchLabel: 'Batch / Lot No.',
      batchValue: 'MX-ONC-260418A',
      mfgDateLabel: 'Mfg. Date',
      mfgDateValue: '2026-04',
      expDateLabel: 'Expiry Date',
      expDateValue: '2028-04 (24 Months Validated)',
      originLabel: 'Manufacturer Status',
      originValue: 'WHO-GMP & DGDA Licensed Oncology Facility (Bangladesh)',
      storageLabel: 'Storage Condition',
      storageValue: 'Store below 30°C in original tamper-evident container',
      tableHeaders: ['Test Parameter', 'Pharmacopoeia Spec', 'Batch Result', 'Status'],
      rows: [
        ['Appearance', 'Light brown, oval, biconvex film-coated tablets', 'Conforms visually', 'PASS'],
        ['Identification (HPLC / UV)', 'Retention time matches USP reference standard', 'Positive match (Rt = 6.42 min)', 'PASS'],
        ['Assay (Osimertinib)', '98.0% – 102.0% of labeled claim', '99.4% w/w', 'PASS'],
        ['Dissolution (30 min)', 'NLT 80% (Q) of labeled amount', '96.2% mean released', 'PASS'],
        ['Related Substances', 'Individual impurity <= 0.2%; Total <= 0.5%', 'Single max 0.08%; Total 0.19%', 'PASS'],
        ['Water Content (KF)', 'Not more than 3.0% w/w', '1.1% w/w', 'PASS'],
        ['Microbial Enumeration', 'TAMC <= 10^3 CFU/g; E. coli absent', 'Absent / Within USP <61>', 'PASS'],
      ],
      qaSignOffLabel: 'Released By',
      qaSignOffValue: 'Quality Assurance & Export Compliance Unit • Digital Lot Verification Active',
      disclaimer:
        'Watermarked sample template for procurement evaluation. Batch-matched factory CoA, MSDS, and Certificate of Origin are issued upon proforma confirmation.',
      printAction: 'Print Sample CoA',
      requestVerifiedCta: 'Request Real Batch CoA & Quote',
      close: 'Close preview',
    },
    quoteModal: {
      title: 'Request Service & Export Quotation',
      subtitle: 'Share your sourcing, cold-chain, or bulk fulfillment parameters for a private commercial proposal.',
      companyLabel: 'Company / Hospital Name',
      companyPlaceholder: 'e.g., Horizon Oncology Medical Center / Pacific Pharma Ltd.',
      contactPersonLabel: 'Contact Person',
      contactPersonPlaceholder: 'Full name & role (e.g., Dr. Lin / Procurement Director)',
      channelLabel: 'Email / WeChat / WhatsApp',
      channelPlaceholder: 'buyer@hospital.org or +86 / +880 WhatsApp or WeChat ID',
      serviceTypeLabel: 'Service Type',
      medicineLabel: 'Medicine / Generic Name & Quantity',
      medicinePlaceholder: 'e.g., Osimertinib 80mg x 60 boxes, Trastuzumab 440mg x 12 vials',
      destinationLabel: 'Destination Country',
      destinationPlaceholder: 'Select destination country',
      submitLabel: 'Submit Service Quote Request',
      submittingLabel: 'Sending Request…',
      close: 'Close modal',
      securityNote: 'Confidential B2B handling. No pricing or institutional records are published.',
      fullRfqLink: 'Need prescription upload or multi-SKU cart checkout? Open full RFQ Workspace ->',
      validationSummary: 'Please complete the highlighted fields before submitting.',
      requiredField: 'This field is required.',
      invalidChannel: 'Enter a valid email address, WhatsApp number, or WeChat ID.',
      successTitle: 'Service Quotation Request Recorded',
      successSubtitle: 'Our B2B export & sourcing coordination desk has received your parameters and will respond within 4 business hours.',
      referenceLabel: 'Request Reference',
      summaryHeading: 'Submitted Summary',
      whatsAppFallback: 'Send Instant Copy via WhatsApp Desk',
      submitAnother: 'Submit Another Request',
      countries: [
        { code: 'CN', label: 'CN — China (Mainland)' },
        { code: 'HK', label: 'HK — Hong Kong SAR' },
        { code: 'SG', label: 'SG — Singapore' },
        { code: 'MY', label: 'MY — Malaysia' },
        { code: 'VN', label: 'VN — Vietnam' },
        { code: 'PH', label: 'PH — Philippines' },
        { code: 'TH', label: 'TH — Thailand' },
        { code: 'ID', label: 'ID — Indonesia' },
        { code: 'IN', label: 'IN — India' },
        { code: 'AE', label: 'AE — United Arab Emirates' },
        { code: 'SA', label: 'SA — Saudi Arabia' },
        { code: 'TR', label: 'TR — Turkey' },
        { code: 'DE', label: 'DE — Germany' },
        { code: 'GB', label: 'GB — United Kingdom' },
        { code: 'US', label: 'US — United States' },
        { code: 'BD', label: 'BD — Bangladesh' },
      ],
    },
  },
  zh: {
    langToggleLabel: '页面语言',
    breadcrumbHome: '首页',
    breadcrumbServices: '服务',
    breadcrumbSourcing: '全球医药采购',
    hero: {
      badge: '全球医药冷链物流与合规保障',
      title: '端到端医药供应链与国际出口解决方案',
      subtitle:
        '为全球肿瘤及重症急需药品提供专业冷链物流、持牌制药企业直采，以及每批次可核验的 CoA 质检合规文件支持。',
      primaryCta: '立即快速询价',
      secondaryCta: '浏览核心服务',
      detailBadge: '持牌药企直采服务',
      detailSubtitle:
        '直接对接获得 WHO-GMP、EU-GMP 与 DGDA 许可的制药企业，为批发买家、医疗机构与指定患者提供合规肿瘤药采购方案。',
      laneHeader: '国际医药出口专线',
      laneRoute: 'DAC (达卡) -> PVG / HKG / SIN / DXB',
      laneStatus: '清关预审通道',
      tempMetricLabel: '实时温控状态',
      tempMetricValue: '4.2°C 稳定',
      dispatchMetricLabel: '加急发出时效',
      dispatchMetricValue: '48–72 小时',
      trustBadges: ['2°C–8°C 认证冷链', '100% 批次 CoA 核验', '48–72 小时极速发出'],
    },
    tabsAriaLabel: '医药服务导航',
    tabs: [
      { id: 'cold-chain', label: '冷链物流' },
      { id: 'sourcing', label: '全球医药采购' },
      { id: 'coa-support', label: '合规与 CoA 支持' },
      { id: 'emergency-delivery', label: '紧急药品配送' },
      { id: 'bulk-order', label: '批量订单履约' },
    ],
    services: [
      {
        id: 'cold-chain',
        stepCode: '01',
        eyebrow: '冷链物流',
        title: '经验证的生物制剂与肿瘤注射剂冷链运输',
        summary: '依据 GDP 标准控温与全程温度遥测，确保药品从药企冷库直达临床收货端效价稳定无断链。',
        highlights: [
          '针对生物制剂与肿瘤注射剂提供经过验证的 2°C 至 8°C（冷藏）及 -20°C（冷冻）温控包装。',
          '采用配比相变蓄冷凝胶冰排的主动式与被动式高效隔热保温箱。',
          '每票冷链货件均配备 24/7 数字 USB 与云端温度数据记录仪。',
        ],
        quoteActionLabel: '咨询冷链方案报价',
      },
      {
        id: 'sourcing',
        stepCode: '02',
        eyebrow: '全球医药采购',
        title: '持牌制药企业直采与全批次效期可追溯',
        summary: '绕过中间流转风险，直接从资质完备的肿瘤药生产商锁定正规批次与长效期库存。',
        highlights: [
          '直接向通过 WHO-GMP、EU-GMP 及 US-FDA 认证标准的制药企业采购。',
          '专注于罕见病、紧缺药品及新获批肿瘤靶向仿制药采购（如奥希替尼 Osimertinib、洛拉替尼 Lorlatinib）。',
          '严格批次追溯体系与长效期承诺（确保至少 18–24 个月以上剩余有效期）。',
        ],
        secondaryLinkLabel: '查看孟加拉直采详情',
        quoteActionLabel: '查询药企直采库存',
      },
      {
        id: 'coa-support',
        aliasId: 'compliance',
        stepCode: '03',
        eyebrow: '合规与 COA 支持',
        title: '随附批次 CoA、MSDS 与目的国清关文件套件',
        summary: '随货与电子端双轨提供原厂质检档案与清关预审指导，大幅降低口岸滞留风险。',
        highlights: [
          '提供对应批号的原厂分析证书（CoA）、化学品安全技术说明书（MSDS）及原产地证明（CoO）。',
          '完整的出口报关文件、空运主运单（AWB）预报信息及目的国进口许可办理指引。',
          '起运前提前交付电子版核验档案，便于医院质量管理及买方清关复核。',
        ],
        primaryActionLabel: '预览样本 CoA',
        quoteActionLabel: '申请清关文件核验',
      },
      {
        id: 'emergency-delivery',
        aliasId: 'delivery',
        stepCode: '04',
        eyebrow: '紧急药品配送',
        title: '48–72 小时重症急需药品优先航空专线',
        summary: '面对住院重症与指定患者临床急用，立即启动医疗加急空运与预清关协同通道。',
        highlights: [
          '通过 DHL Medical Express、FedEx Priority 及专业医药专线提供优先医疗航空快递。',
          '针对紧急指定患者与医院重症科室需求，实现 48–72 小时快速国际发出。',
          '专属清关预审团队提前核对税号及文件，避免目的港口岸延误。',
        ],
        quoteActionLabel: '预约加急空运排期',
      },
      {
        id: 'bulk-order',
        aliasId: 'bulk',
        stepCode: '05',
        eyebrow: '批量订单履约',
        title: '医疗机构分级批发供货与多 SKU 集拼履约',
        summary: '支持分级大宗折扣、防篡改出口主箱集拼封装，以及面向医院和区域总代的季度常备供货协议。',
        highlights: [
          '面向医院、肿瘤专科诊所、公益医疗机构与区域经销商提供阶梯式批发价与批量折扣。',
          '支持多 SKU 统一合箱发货，采用防篡改封条出口加固外箱。',
          '配备专属 B2B 大客户经理，保障季度/月度周期性稳定补货合同执行。',
        ],
        primaryActionLabel: '申请批量采购报价',
        quoteActionLabel: '洽谈机构集采合同',
      },
    ],
    visuals: {
      coldChain: {
        title: '实时冷链温控监测看板',
        statusStable: '4.2°C 稳定',
        modeRefrigerated: '2°C–8°C 生物制剂',
        modeFrozen: '-20°C 深冷冷冻',
        currentTempLabel: '箱内探头 CH-01',
        rangeLabel: '合格控温区间',
        refrigeratedRange: '2.0°C – 8.0°C',
        frozenRange: '-22.0°C – -18.0°C',
        loggerLabel: '记录仪配置',
        loggerValue: 'USB + 云端 24/7 记录',
        holdTimeLabel: '连续保温时长',
        holdTimeValue: '120 小时被动控温',
        excursionLabel: '超温告警记录',
        excursionValue: '0 次告警 • 全程合规',
        probeReadout: '实时探头遥测曲线 • 出口冷链样本通道',
      },
      sourcing: {
        title: '原厂批号溯源与认证状态',
        subtitle: '每一批次均可追溯至持牌厂区',
        badges: ['WHO-GMP', 'EU-GMP', 'US-FDA 认证体系'],
        batches: [
          {
            molecule: '奥希替尼 Osimertinib 80mg 片剂',
            strength: '靶向 EGFR-TKI • 30片瓶装',
            batchCode: '批号 #OS-2604A',
            expiry: '余效期: 23 个月',
            facility: '持牌肿瘤一车间',
          },
          {
            molecule: '洛拉替尼 Lorlatinib 100mg 薄膜片',
            strength: '第三代 ALK 抑制剂 • 铝塑装',
            batchCode: '批号 #LR-2602B',
            expiry: '余效期: 24 个月',
            facility: '持牌肿瘤二车间',
          },
        ],
        traceabilityLabel: '最低剩余有效期保证',
        traceabilityValue: '确保 >= 18–24 个月',
      },
      coaSupport: {
        title: '出口合规与清关文件核验单',
        subtitle: '货物交付承运商前完成双审备案',
        badges: ['CoA Verified', 'GMP Certified', 'Customs Cleared'],
        documents: [
          { code: 'COA', name: '原厂批次分析检验报告 (HPLC 与溶出度)', status: 'QA 已签批' },
          { code: 'MSDS', name: '16 项国际通用化学品安全技术说明书', status: '已核验' },
          { code: 'COO', name: '商会签章出口原产地证明文件', status: '已备妥' },
          { code: 'AWB', name: '航空主运单预报与详细装箱清单', status: '已发送' },
        ],
        dossierNote: '同步随箱附带防潮文件袋及加密电子 PDF 备份',
      },
      emergencyDelivery: {
        title: '紧急药品空运履约时间轴',
        carrierLabel: 'DHL Medical Express / FedEx Priority',
        priorityCode: '时效: 48–72 小时',
        stages: [
          { title: '订单确认', timing: 'T + 0h', detail: '锁定原厂现货批号与质检文件' },
          { title: '冷链封装 (6h)', timing: 'T + 6h', detail: '相变冰排封装并激活 USB 温控记录仪' },
          { title: '优先空运', timing: 'T + 18h', detail: '优先配载国际医疗航空快件舱位' },
          { title: '清关送达', timing: 'T + 48–72h', detail: '预清关放行并交付至医院或买家指定收货方' },
        ],
        clearanceNote: '航班落地前由专属清关协同团队完成单证预审核。',
      },
      bulkOrder: {
        title: '机构分级采购与集拼矩阵',
        subtitle: '专为医疗中心、渠道批发商与招标客户打造',
        tiers: [
          { segment: '医院与肿瘤治疗中心', scope: '50 – 500 盒/批', benefit: '临床优先配额 + 原厂整批锁定' },
          { segment: '区域医药进口经销商', scope: '500 – 5,000+ 盒', benefit: '阶梯批发返利 + 多品类混合集拼' },
          { segment: 'NGO 与国际医疗援助标书', scope: '季度/年度多批合约', benefit: '出口加强主箱包装 + 专人统筹' },
        ],
        consolidationLabel: '出口主箱安全封装',
        consolidationValue: '防拆安全封条 + 多 SKU 汇总装箱单',
      },
    },
    workflow: {
      eyebrow: '出口履约流程',
      title: '标准化 4 步国际医药出口流程',
      subtitle: '兼顾采购时效、质量审计透明度与跨国口岸清关可控性。',
      steps: [
        {
          number: '01',
          title: '提交通用名 / SKU 采购清单',
          description: '填写所需药品通用名、规格、采购数量及目的国/城市口岸信息。',
        },
        {
          number: '02',
          title: '形式发票报价与 CoA 核验',
          description: '在4个工作小时内获取私密报价、现货批号效期及原厂 CoA 样本。',
        },
        {
          number: '03',
          title: '冷链封装与出口清关单证',
          description: '完成经验证的冷链保温箱封装、防拆封箱以及 MSDS/CoO 全套单证准备。',
        },
        {
          number: '04',
          title: '优先空运发出与全程追踪',
          description: '由 DHL 医疗快递或 FedEx 优先发运，抵达后可读取完整温控数据。',
        },
      ],
    },
    faq: {
      eyebrow: '常见问题解答',
      title: 'B2B 冷链、质量审核与出口清关 FAQ',
      subtitle: '解答医院采购负责人、经销商与临床对接团队最关心的履约问题。',
      items: [
        {
          question: '长途国际空运中，如何确保生物制剂与注射剂的温度始终达标？',
          answer:
            '所有温敏生物制剂和肿瘤注射剂均采用经过性能验证（PQ）的真空隔热冷链箱与多相变储能冰排组合封装（最长支持 120 小时连续控温），箱内随附每 5 分钟自动采样的校准 USB/云端温度记录仪。',
        },
        {
          question: '付款之前可以先核验对应批次的 CoA 质检报告吗？',
          answer:
            '可以。当我们的采购团队为您的订单锁定现货批次后，会在形式发票（PI）确认阶段即为您提供脱敏的批次 CoA 分析报告、效期证明及生产企业 GMP 资质文件供审核。',
        },
        {
          question: '发往中国、亚洲其他地区或中东清关时提供哪些出口单证？',
          answer:
            '标准单证包含商业发票、详细装箱单、对应批次 CoA、16 项 MSDS、原产地证（CoO）、航空运单预报（AWB Pre-Alert）及协助临床/患者自用或机构进口的合规说明函。',
        },
        {
          question: '大宗批发采购与紧急急救药品订单的起订量（MOQ）有何区别？',
          answer:
            '患者指定与医院紧急临床需求不设高起订门槛，支持单疗程急件空运直发；B2B 商业批发阶梯价格与集拼服务则按具体通用名分档，通常由整箱多盒起享有大宗折扣。',
        },
      ],
    },
    bottomCta: {
      eyebrow: '定制化国际医药供应链',
      title: '需要定制医药冷链物流或大宗药品采购方案？',
      subtitle: '立即联系 MedAxis 国际医药采购与冷链运作专员，通常 4 个工作小时内交付私密专属报价。',
      primaryCta: '立即快速询价',
      secondaryCta: '浏览全部药品目录',
    },
    coaModal: {
      title: '原厂批次分析检验报告（CoA 样本预览）',
      subtitle: '以下为发货前核验标准样本格式。正式交付给买方的 CoA 将与所发货物原厂批号一一对应。',
      watermark: 'MedAxis Global Pharma - Verified Batch CoA',
      docNumberLabel: '文件编号',
      docNumber: 'COA-MX-2026-0418-SAMPLE',
      productLabel: '药品名称 / 通用名',
      productValue: '甲磺酸奥希替尼片 Osimertinib 80mg（薄膜衣片）',
      batchLabel: '生产批号 Lot No.',
      batchValue: 'MX-ONC-260418A',
      mfgDateLabel: '生产日期',
      mfgDateValue: '2026-04',
      expDateLabel: '有效期至',
      expDateValue: '2028-04（24 个月验证效期）',
      originLabel: '生产工厂资质',
      originValue: 'WHO-GMP 及 DGDA 认证肿瘤药品生产车间（孟加拉国）',
      storageLabel: '贮藏条件',
      storageValue: '30°C 以下原厂防拆封瓶装避光干燥保存',
      tableHeaders: ['检验项目', '药典质量标准', '本批实测结果', '判定结论'],
      rows: [
        ['性状外观', '浅棕色椭圆形双凸面薄膜衣片', '外观色泽均匀完整，符合规定', '符合 / PASS'],
        ['鉴别 (HPLC / UV)', '主峰保留时间与 USP 对照品一致', '呈正匹配 (Rt = 6.42 min)', '符合 / PASS'],
        ['含量测定 (奥希替尼)', '标示量的 98.0% – 102.0%', '99.4% w/w', '符合 / PASS'],
        ['溶出度 (30 分钟)', '不得少于标示量的 80% (Q)', '平均溶出度 96.2%', '符合 / PASS'],
        ['有关物质与杂质', '单一未知杂质 <= 0.2%；总杂质 <= 0.5%', '最大单杂 0.08%；总杂 0.19%', '符合 / PASS'],
        ['水分测定 (卡尔·费休法)', '不得过 3.0% w/w', '1.1% w/w', '符合 / PASS'],
        ['微生物限度检验', '需氧菌总数 <= 10^3 CFU/g；不得检出大肠埃希菌', '未检出致病菌 / 符合标准', '符合 / PASS'],
      ],
      qaSignOffLabel: '质量授权放行',
      qaSignOffValue: 'Quality Assurance & Export Compliance Unit • 批次电子核验有效',
      disclaimer: '此文件为采购评估水印样本。确认形式发票并锁批后，我方将出具盖章原厂批次 CoA、MSDS 及 CoO 完整档案。',
      printAction: '打印样本 CoA',
      requestVerifiedCta: '索取实批 CoA 并询价',
      close: '关闭预览',
    },
    quoteModal: {
      title: '快速询价与专属供应链方案咨询',
      subtitle: '请填写您的企业或医院采购需求、所需服务类型与目的地信息，团队将尽快回复专属报价。',
      companyLabel: '公司 / 医院名称',
      companyPlaceholder: '例如：XX 肿瘤医院采购办 / 某国际医药贸易有限公司',
      contactPersonLabel: '联系人姓名',
      contactPersonPlaceholder: '请填写您的姓名及职务',
      channelLabel: '邮箱 / 微信 / WhatsApp',
      channelPlaceholder: '邮箱 buyer@hospital.org 或微信号 / +86 / +880 手机号',
      serviceTypeLabel: '服务类型',
      medicineLabel: '药品通用名及采购数量',
      medicinePlaceholder: '例如：奥希替尼 Osimertinib 80mg x 60 盒，曲妥珠单抗 440mg x 12 支',
      destinationLabel: '目的国 / 地区',
      destinationPlaceholder: '请选择目的国 / 地区',
      submitLabel: '提交服务询价申请',
      submittingLabel: '正在提交…',
      close: '关闭弹窗',
      securityNote: '严格 B2B 商业保密处理，不公开展示价格或医疗机构采购信息。',
      fullRfqLink: '需要上传处方或多品规清单？进入完整 RFQ 工作台 ->',
      validationSummary: '请先完善下方标红提示的必填项后再提交。',
      requiredField: '此项为必填内容。',
      invalidChannel: '请输入有效的电子邮箱、WhatsApp 号码或微信号。',
      successTitle: '服务询价已成功登记',
      successSubtitle: 'MedAxis 国际采购与冷链协调团队已记录您的请求，通常在 4 个工作小时内反馈正式方案。',
      referenceLabel: '询价参考编号',
      summaryHeading: '您提交的需求摘要',
      whatsAppFallback: '通过 WhatsApp 专席立即同步需求',
      submitAnother: '继续提交新询价',
      countries: [
        { code: 'CN', label: 'CN — 中国内地' },
        { code: 'HK', label: 'HK — 中国香港' },
        { code: 'SG', label: 'SG — 新加坡' },
        { code: 'MY', label: 'MY — 马来西亚' },
        { code: 'VN', label: 'VN — 越南' },
        { code: 'PH', label: 'PH — 菲律宾' },
        { code: 'TH', label: 'TH — 泰国' },
        { code: 'ID', label: 'ID — 印度尼西亚' },
        { code: 'IN', label: 'IN — 印度' },
        { code: 'AE', label: 'AE — 阿联酋' },
        { code: 'SA', label: 'SA — 沙特阿拉伯' },
        { code: 'TR', label: 'TR — 土耳其' },
        { code: 'DE', label: 'DE — 德国' },
        { code: 'GB', label: 'GB — 英国' },
        { code: 'US', label: 'US — 美国' },
        { code: 'BD', label: 'BD — 孟加拉国' },
      ],
    },
  },
};
