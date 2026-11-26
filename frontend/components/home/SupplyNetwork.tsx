'use client';

import { useState } from 'react';
import { ChevronRight, LocateFixed, MapPin, Minus, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useSupplyMapView } from '../../hooks/useSupplyMapView';
import type { SupplyDestination } from '../../lib/supply-network';

export function SupplyNetwork({ destinations }: { destinations: SupplyDestination[] }) {
  const t = useTranslations('Home');
  const locale = useLocale();
  const [selected, setSelected] = useState<string>();
  const { viewport, controls, zoomIn, zoomOut, reset, focus } = useSupplyMapView(destinations, t('networkHub'), locale, setSelected);
  const active = destinations.find((location) => location.country === selected);

  return (
    <section className="supply-network-section" id="supply-network" aria-labelledby="supply-network-heading">
      <div className="site-container">
        <div className="supply-network-heading">
          <div>
            <h2 id="supply-network-heading">{t('networkTitle')}</h2>
            <p>{t('networkDescription')}</p>
          </div>
          <div className="supply-network-hub"><MapPin size={18} aria-hidden="true" />{t('networkHub')}</div>
        </div>
        <div className="supply-network-card">
          <div className="supply-network-map-panel">
            <div className="supply-network-map-frame">
              <div ref={viewport} className="supply-network-map" role="group" tabIndex={0}
                aria-label={t('networkMap')} aria-describedby="supply-network-map-hint" />
              <span className={`supply-network-location${active ? ' is-destination' : ''}`} role="status">
                <span aria-hidden="true" />{active?.name ?? t('networkHubCity')}
              </span>
            </div>
            <div className="supply-network-controls">
              <button type="button" aria-label={t('networkZoomIn')} title={t('networkZoomIn')} disabled={!controls.canZoomIn}
                onClick={zoomIn}><Plus size={19} aria-hidden="true" /></button>
              <button type="button" aria-label={t('networkZoomOut')} title={t('networkZoomOut')} disabled={!controls.canZoomOut}
                onClick={zoomOut}><Minus size={19} aria-hidden="true" /></button>
              <button type="button" aria-label={t('networkReset')} title={t('networkReset')} disabled={!controls.canReset}
                onClick={reset}><LocateFixed size={17} aria-hidden="true" /></button>
            </div>
            <p id="supply-network-map-hint" className="supply-network-map-hint">{t('networkMapHint')}</p>
          </div>
          <aside className="supply-network-destinations" aria-labelledby="supply-network-destinations-heading">
            <h3 id="supply-network-destinations-heading">{t('networkDestinations')}</h3>
            {destinations.length > 0 ? (
              <ul>
                {destinations.map((location) => (
                  <li key={location.country}>
                    <button type="button" aria-pressed={location.country === selected} onClick={() => focus(location.country)}>
                      <span className="supply-network-destination-dot" aria-hidden="true" />
                      <span>{location.name}</span><ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p>{t('networkEmpty')}</p>}
          </aside>
        </div>
      </div>
    </section>
  );
}
