'use client';
import { useState, type FormEvent } from 'react';
import { apiRequest } from '../../lib/api-client';
import { settingsSchema, type AdminSettings } from '../../lib/admin-workflow';
import { adminFxSchema, type AdminFx } from '../../lib/admin-contract';
import { settingsBody, fxBody, validatedInput } from '../../lib/admin-management';
import { useAdminOperation } from '../../hooks/useAdminOperation';
import { AdminOperationFeedback } from './AdminOperationFeedback';
import { AdminLink } from './AdminShell';
export function SettingsManager({ initial, initialFx }: { initial: AdminSettings; initialFx: AdminFx | null }) {
  const [settings, setSettings] = useState(initial);
  const [fx, setFx] = useState(initialFx);
  const { operation, state } = useAdminOperation();
  const [configured, setConfigured] = useState(initial.wire_instructions?.value.configured ?? false);
  async function refresh() {
    const [config, rates] = await Promise.all([
      apiRequest('/v1/admin/settings', settingsSchema),
      apiRequest('/v1/admin/fx-rates', adminFxSchema),
    ]);
    if (JSON.stringify(config.data) !== JSON.stringify(settings) || JSON.stringify(rates.data) !== JSON.stringify(fx))
      operation.reconcileAdvancedVersion();
    setSettings(config.data);
    setFx(rates.data);
  }
  async function submit(event: FormEvent<HTMLFormElement>, kind: 'packaging' | 'payment' | 'shipping' | 'wire' | 'fx') {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const optional = (key: string) => String(form.get(key) ?? '').trim() || undefined;
    await operation.run(async () => {
      if (kind === 'fx') {
        const rates = ['USD', 'EUR', 'CNY'].map((currency) => ({
          currency,
          active_mode: form.get(`${currency}_mode`),
          ...(optional(`${currency}_rate`) ? { manual_rate_to_bdt: optional(`${currency}_rate`) } : {}),
        }));
        return apiRequest('/v1/admin/fx-rates', adminFxSchema, {
          method: 'PATCH',
          json: validatedInput(fxBody, { rates }),
        });
      }
      const body =
        kind === 'packaging'
          ? {
              packaging_units: {
                units: String(form.get('units'))
                  .split('\n')
                  .map((value) => value.trim())
                  .filter(Boolean),
              },
            }
          : kind === 'payment'
            ? {
                payment_presets: {
                  terms: ['BANK_WIRE_TT'],
                  quote_validity_days: Number(form.get('validity')),
                  reservation_days: 5,
                  business_timezone: 'Asia/Dhaka',
                },
              }
            : kind === 'shipping'
              ? {
                  shipping_presets: {
                    methods: form.getAll('methods'),
                    incoterms: form.getAll('incoterms'),
                  },
                }
              : {
                  wire_instructions: {
                    configured,
                    instructions: form.get('instructions'),
                    ...Object.fromEntries(
                      [
                        'beneficiary_name',
                        'bank_name',
                        'account_number',
                        'swift_code',
                        'bank_address',
                        'currency',
                      ].flatMap((key) => (optional(key) ? [[key, optional(key)]] : [])),
                    ),
                  },
                };
      return apiRequest('/v1/admin/settings', settingsSchema, {
        method: 'PATCH',
        json: validatedInput(settingsBody, body),
      });
    }, refresh);
  }
  const disabled = state.busy || state.blocked;
  const wire = settings.wire_instructions?.value;
  return (
    <>
      <div className="admin-page-heading">
        <h1>Private platform settings</h1>
        <button className="button secondary" disabled={state.busy} onClick={() => void operation.refresh(refresh)}>
          Refresh server state
        </button>
      </div>
      <AdminOperationFeedback state={state} />
      <AdminLink href="/admin/settings/security">Authenticator & session security</AdminLink>
      <p className="small muted">
        Settings stay inside the authenticated console. Published forms receive no private settings response.
        Reservation is fixed at five days, with business timezone Asia/Dhaka.
      </p>
      <form className="admin-panel stack-form" onSubmit={(event) => void submit(event, 'packaging')}>
        <fieldset disabled={disabled}>
          <h2>Packaging units</h2>
          <label>
            Configured units (one per line)
            <textarea name="units" required defaultValue={settings.packaging_units?.value.units.join('\n')} />
          </label>
          <button className="button primary">Save packaging units</button>
        </fieldset>
      </form>
      <form className="admin-panel stack-form" onSubmit={(event) => void submit(event, 'payment')}>
        <fieldset disabled={disabled}>
          <h2>Quotation policy</h2>
          <label>
            Validity days
            <input
              name="validity"
              type="number"
              min="1"
              max="365"
              required
              defaultValue={settings.payment_presets?.value.quote_validity_days}
            />
          </label>
          <p>BANK_WIRE_TT · Reservation 5 days · Asia/Dhaka</p>
          <button className="button primary">Save quotation policy</button>
        </fieldset>
      </form>
      <form className="admin-panel stack-form" onSubmit={(event) => void submit(event, 'shipping')}>
        <fieldset disabled={disabled}>
          <h2>Shipping presets</h2>
          <div className="admin-form-grid">
            <fieldset>
              <legend>Methods</legend>
              {['INCOTERM', 'EXPRESS_COURIER'].map((value) => (
                <label className="admin-check" key={value}>
                  <input
                    name="methods"
                    type="checkbox"
                    value={value}
                    defaultChecked={settings.shipping_presets?.value.methods.some((item) => item === value)}
                  />
                  {value}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Incoterms</legend>
              {['FCA', 'CIP', 'DAP', 'CPT', 'FOB', 'CIF'].map((value) => (
                <label className="admin-check" key={value}>
                  <input
                    name="incoterms"
                    type="checkbox"
                    value={value}
                    defaultChecked={settings.shipping_presets?.value.incoterms.some((item) => item === value)}
                  />
                  {value}
                </label>
              ))}
            </fieldset>
          </div>
          <button className="button primary">Save shipping presets</button>
        </fieldset>
      </form>
      <form className="admin-panel stack-form" onSubmit={(event) => void submit(event, 'wire')}>
        <fieldset disabled={disabled}>
          <h2>Verified wire instructions</h2>
          <label className="admin-check">
            <input
              type="checkbox"
              checked={configured}
              onChange={(event) => setConfigured(event.currentTarget.checked)}
            />
            Wire details are configured
          </label>
          <div className="admin-form-grid">
            {(['beneficiary_name', 'bank_name', 'account_number', 'swift_code', 'bank_address'] as const).map((key) => (
              <label key={key}>
                {key.replaceAll('_', ' ')}
                <input
                  name={key}
                  required={configured && key !== 'bank_address'}
                  defaultValue={wire?.[key]}
                  maxLength={500}
                />
              </label>
            ))}
            <label>
              Currency
              <select name="currency" defaultValue={wire?.currency ?? ''}>
                <option value="">Not specified</option>
                {['USD', 'EUR', 'CNY', 'BDT'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Instructions
            <textarea name="instructions" required maxLength={4000} defaultValue={wire?.instructions} />
          </label>
          <label className="admin-check">
            <input type="checkbox" required />I verified these instructions against authorized company bank records.
          </label>
          <button className="button primary">Save verified wire instructions</button>
        </fieldset>
      </form>
      <form className="admin-panel stack-form" onSubmit={(event) => void submit(event, 'fx')}>
        <fieldset disabled={disabled || !fx}>
          <h2>Server exchange rates to BDT</h2>
          <p>
            Use server live rates or an explicit manual decimal rate. Existing issued quotations retain locked FX. No
            rates are fetched from third parties by this browser.
          </p>
          {fx?.last_error_code && <p role="status">Last refresh: {fx.last_error_code}</p>}
          <div className="admin-form-grid">
            {fx?.rates.map((rate) => (
              <section className="admin-rate" key={rate.currency}>
                <h3>{rate.currency}</h3>
                {rate.available ? (
                  <>
                    <p>
                      Active: {rate.active_rate_to_bdt} · {rate.mode}
                      {rate.stale ? ' · Stale' : ''}
                    </p>
                    <p className="small muted">
                      Fetched {rate.live_fetched_at}
                      <br />
                      Cached {rate.cached_at}
                      <br />
                      Expires {rate.cache_expires_at}
                      <br />
                      Stale at {rate.live_stale_at}
                    </p>
                  </>
                ) : (
                  <p>available: false · rate unavailable</p>
                )}
                <label>
                  Mode
                  <select name={`${rate.currency}_mode`} required defaultValue={rate.available ? rate.mode : ''}>
                    <option value="">Choose a mode</option>
                    <option>LIVE</option>
                    <option>MANUAL_FIXED</option>
                  </select>
                </label>
                <label>
                  Manual rate to BDT (0.1–10000)
                  <input
                    name={`${rate.currency}_rate`}
                    inputMode="decimal"
                    defaultValue={rate.available ? rate.manual_rate_to_bdt : undefined}
                  />
                </label>
              </section>
            ))}
          </div>
          {!fx && <p>Exchange-rate configuration is unavailable. Refresh before editing.</p>}
          <button className="button primary">Save FX modes</button>
        </fieldset>
      </form>
    </>
  );
}
