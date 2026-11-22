'use client';

import { useState } from 'react';
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock,
  FileCheck2,
  Globe,
  Layers,
  Package,
  Plane,
  ShieldCheck,
  Snowflake,
  Thermometer,
} from 'lucide-react';
import type { ServiceId, ServicesCopy } from './services-copy';

export function HeroVisual({ hero }: { hero: ServicesCopy['hero'] }) {
  return (
    <div className="svc-hero-visual-wrap">
      <div className="svc-hero-card">
        <div className="svc-hero-card-top">
          <div className="svc-lane-tag">
            <span className="svc-pulse-dot" aria-hidden="true" />
            <span>{hero.laneHeader}</span>
          </div>
          <span className="svc-lane-pill">{hero.laneStatus}</span>
        </div>

        <div className="svc-lane-route">
          <Plane size={18} aria-hidden="true" />
          <strong>{hero.laneRoute}</strong>
        </div>

        <div className="svc-hero-illustration" aria-hidden="true">
          <svg viewBox="0 0 420 156" fill="none" className="svc-hero-svg">
            <defs>
              <linearGradient id="svcLaneGrad" x1="0" y1="0" x2="420" y2="156" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#18A0FB" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#0D7A8A" stopOpacity="0.06" />
              </linearGradient>
              <linearGradient id="svcArcGrad" x1="48" y1="98" x2="368" y2="42" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#18A0FB" />
                <stop offset="100%" stopColor="#5B8DEF" />
              </linearGradient>
            </defs>
            <rect x="0.5" y="0.5" width="419" height="155" rx="14" fill="url(#svcLaneGrad)" stroke="rgba(255,255,255,0.14)" />
            <path d="M52 108C124 38 242 28 368 48" stroke="url(#svcArcGrad)" strokeWidth="2.5" strokeDasharray="6 6" strokeLinecap="round" />
            <circle cx="52" cy="108" r="7" fill="#18A0FB" />
            <circle cx="52" cy="108" r="14" fill="#18A0FB" fillOpacity="0.2" />
            <circle cx="212" cy="49" r="5" fill="#5B8DEF" />
            <circle cx="368" cy="48" r="7" fill="#2DD4BF" />
            <circle cx="368" cy="48" r="14" fill="#2DD4BF" fillOpacity="0.2" />

            <g transform="translate(174 68)">
              <rect width="74" height="58" rx="9" fill="#0F172A" stroke="rgba(24,160,251,0.55)" strokeWidth="1.5" />
              <rect x="8" y="8" width="58" height="12" rx="4" fill="rgba(24,160,251,0.16)" />
              <path d="M16 14H46" stroke="#18A0FB" strokeWidth="2.5" strokeLinecap="round" />
              <rect x="8" y="27" width="26" height="22" rx="4" fill="rgba(13,122,138,0.45)" stroke="rgba(255,255,255,0.18)" />
              <path d="M21 33V43M16 38H26" stroke="#E0F7FA" strokeWidth="2.2" strokeLinecap="round" />
              <rect x="40" y="27" width="26" height="22" rx="4" fill="rgba(91,141,239,0.22)" stroke="rgba(255,255,255,0.18)" />
              <path d="M47 36L51 40L59 32" stroke="#2DD4BF" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </svg>
        </div>

        <div className="svc-hero-metrics">
          <div className="svc-hero-metric">
            <Thermometer size={17} aria-hidden="true" />
            <div>
              <span>{hero.tempMetricLabel}</span>
              <strong>{hero.tempMetricValue}</strong>
            </div>
          </div>
          <div className="svc-hero-metric">
            <Clock size={17} aria-hidden="true" />
            <div>
              <span>{hero.dispatchMetricLabel}</span>
              <strong>{hero.dispatchMetricValue}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="svc-floating-badges" aria-label="Service trust credentials">
        <div className="svc-trust-pill">
          <Snowflake size={15} aria-hidden="true" />
          <span>{hero.trustBadges[0]}</span>
        </div>
        <div className="svc-trust-pill">
          <FileCheck2 size={15} aria-hidden="true" />
          <span>{hero.trustBadges[1]}</span>
        </div>
        <div className="svc-trust-pill">
          <Plane size={15} aria-hidden="true" />
          <span>{hero.trustBadges[2]}</span>
        </div>
      </div>
    </div>
  );
}

function ColdChainVisual({ data }: { data: ServicesCopy['visuals']['coldChain'] }) {
  const [mode, setMode] = useState<'refrigerated' | 'frozen'>('refrigerated');
  const activeTemp = mode === 'refrigerated' ? '4.2°C' : '-20.1°C';
  const activeRange = mode === 'refrigerated' ? data.refrigeratedRange : data.frozenRange;

  return (
    <div className="svc-visual-card">
      <div className="svc-visual-head">
        <div className="svc-visual-title">
          <Thermometer size={18} aria-hidden="true" />
          <span>{data.title}</span>
        </div>
        <span className="svc-status-badge is-live">
          <span className="svc-pulse-dot" aria-hidden="true" />
          {mode === 'refrigerated' ? data.statusStable : '-20.1°C'}
        </span>
      </div>

      <div className="svc-mode-switch" role="tablist" aria-label={data.title}>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'refrigerated'}
          className={mode === 'refrigerated' ? 'is-active' : undefined}
          onClick={() => setMode('refrigerated')}
        >
          <Snowflake size={14} aria-hidden="true" />
          <span>{data.modeRefrigerated}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'frozen'}
          className={mode === 'frozen' ? 'is-active' : undefined}
          onClick={() => setMode('frozen')}
        >
          <Activity size={14} aria-hidden="true" />
          <span>{data.modeFrozen}</span>
        </button>
      </div>

      <div className="svc-telemetry-hero">
        <div>
          <span className="svc-meta-label">{data.currentTempLabel}</span>
          <div className="svc-temp-readout">{activeTemp}</div>
        </div>
        <div className="svc-temp-bounds">
          <span className="svc-meta-label">{data.rangeLabel}</span>
          <strong>{activeRange}</strong>
        </div>
      </div>

      <div className="svc-sparkline-box" aria-hidden="true">
        <svg viewBox="0 0 360 88" fill="none" className="svc-sparkline-svg">
          <rect x="0" y="16" width="360" height="52" rx="6" fill="#0D7A8A" fillOpacity="0.06" />
          <line x1="0" y1="16" x2="360" y2="16" stroke="#18A0FB" strokeOpacity="0.45" strokeDasharray="4 4" />
          <line x1="0" y1="68" x2="360" y2="68" stroke="#18A0FB" strokeOpacity="0.45" strokeDasharray="4 4" />
          <path
            d={
              mode === 'refrigerated'
                ? 'M12 44 C 52 40, 88 46, 132 42 C 176 38, 212 43, 256 41 C 296 39, 326 42, 348 40'
                : 'M12 48 C 56 46, 98 51, 144 47 C 188 44, 232 49, 276 46 C 308 44, 328 47, 348 46'
            }
            stroke="#0D7A8A"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="348" cy={mode === 'refrigerated' ? 40 : 46} r="5" fill="#0D7A8A" />
        </svg>
        <p className="svc-sparkline-caption">{data.probeReadout}</p>
      </div>

      <dl className="svc-kv-grid">
        <div>
          <dt>{data.loggerLabel}</dt>
          <dd>{data.loggerValue}</dd>
        </div>
        <div>
          <dt>{data.holdTimeLabel}</dt>
          <dd>{data.holdTimeValue}</dd>
        </div>
        <div>
          <dt>{data.excursionLabel}</dt>
          <dd className="is-good">{data.excursionValue}</dd>
        </div>
      </dl>
    </div>
  );
}

function SourcingVisual({ data }: { data: ServicesCopy['visuals']['sourcing'] }) {
  return (
    <div className="svc-visual-card">
      <div className="svc-visual-head">
        <div className="svc-visual-title">
          <Globe size={18} aria-hidden="true" />
          <span>{data.title}</span>
        </div>
      </div>
      <p className="svc-visual-subtitle">{data.subtitle}</p>

      <div className="svc-cert-row">
        {data.badges.map((badge) => (
          <span key={badge} className="svc-cert-pill">
            <ShieldCheck size={14} aria-hidden="true" />
            {badge}
          </span>
        ))}
      </div>

      <div className="svc-batch-list">
        {data.batches.map((item) => (
          <div key={item.batchCode} className="svc-batch-item">
            <div className="svc-batch-top">
              <strong>{item.molecule}</strong>
              <span className="svc-batch-tag">{item.batchCode}</span>
            </div>
            <p className="svc-batch-meta">{item.strength}</p>
            <div className="svc-batch-foot">
              <span>{item.facility}</span>
              <span className="svc-expiry-tag">{item.expiry}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="svc-visual-footer-strip">
        <span>{data.traceabilityLabel}</span>
        <strong>{data.traceabilityValue}</strong>
      </div>
    </div>
  );
}

function CoaVisual({ data }: { data: ServicesCopy['visuals']['coaSupport'] }) {
  return (
    <div className="svc-visual-card">
      <div className="svc-visual-head">
        <div className="svc-visual-title">
          <FileCheck2 size={18} aria-hidden="true" />
          <span>{data.title}</span>
        </div>
      </div>
      <p className="svc-visual-subtitle">{data.subtitle}</p>

      <div className="svc-cert-row">
        {data.badges.map((badge) => (
          <span key={badge} className="svc-cert-pill is-verified">
            <CheckCircle2 size={14} aria-hidden="true" />
            {badge}
          </span>
        ))}
      </div>

      <ul className="svc-doc-checklist">
        {data.documents.map((doc) => (
          <li key={doc.code}>
            <span className="svc-doc-code">{doc.code}</span>
            <span className="svc-doc-name">{doc.name}</span>
            <span className="svc-doc-status">{doc.status}</span>
          </li>
        ))}
      </ul>

      <div className="svc-visual-footer-strip">
        <ShieldCheck size={16} aria-hidden="true" />
        <strong>{data.dossierNote}</strong>
      </div>
    </div>
  );
}

function EmergencyVisual({ data }: { data: ServicesCopy['visuals']['emergencyDelivery'] }) {
  return (
    <div className="svc-visual-card">
      <div className="svc-visual-head">
        <div className="svc-visual-title">
          <Plane size={18} aria-hidden="true" />
          <span>{data.title}</span>
        </div>
        <span className="svc-status-badge">{data.priorityCode}</span>
      </div>
      <p className="svc-visual-subtitle">{data.carrierLabel}</p>

      <ol className="svc-transit-timeline">
        {data.stages.map((stage, index) => (
          <li key={stage.title} className="svc-transit-step">
            <div className="svc-transit-node" aria-hidden="true">
              <span>{index + 1}</span>
            </div>
            <div className="svc-transit-copy">
              <div className="svc-transit-row">
                <strong>{stage.title}</strong>
                <span>{stage.timing}</span>
              </div>
              <p>{stage.detail}</p>
            </div>
            {index < data.stages.length - 1 && <ArrowRight size={14} className="svc-transit-arrow" aria-hidden="true" />}
          </li>
        ))}
      </ol>

      <div className="svc-visual-footer-strip">
        <Clock size={16} aria-hidden="true" />
        <span>{data.clearanceNote}</span>
      </div>
    </div>
  );
}

function BulkVisual({ data }: { data: ServicesCopy['visuals']['bulkOrder'] }) {
  return (
    <div className="svc-visual-card">
      <div className="svc-visual-head">
        <div className="svc-visual-title">
          <Boxes size={18} aria-hidden="true" />
          <span>{data.title}</span>
        </div>
      </div>
      <p className="svc-visual-subtitle">{data.subtitle}</p>

      <div className="svc-tier-stack">
        {data.tiers.map((tier) => (
          <div key={tier.segment} className="svc-tier-row">
            <div className="svc-tier-head">
              <strong>{tier.segment}</strong>
              <span className="svc-tier-scope">{tier.scope}</span>
            </div>
            <p>{tier.benefit}</p>
          </div>
        ))}
      </div>

      <div className="svc-visual-footer-strip">
        <Package size={16} aria-hidden="true" />
        <div>
          <span>{data.consolidationLabel}: </span>
          <strong>{data.consolidationValue}</strong>
        </div>
      </div>
    </div>
  );
}

export function ServiceVisual({ serviceId, visuals }: { serviceId: ServiceId; visuals: ServicesCopy['visuals'] }) {
  switch (serviceId) {
    case 'cold-chain':
      return <ColdChainVisual data={visuals.coldChain} />;
    case 'sourcing':
      return <SourcingVisual data={visuals.sourcing} />;
    case 'coa-support':
      return <CoaVisual data={visuals.coaSupport} />;
    case 'emergency-delivery':
      return <EmergencyVisual data={visuals.emergencyDelivery} />;
    case 'bulk-order':
      return <BulkVisual data={visuals.bulkOrder} />;
    default:
      return <Layers size={32} aria-hidden="true" />;
  }
}
