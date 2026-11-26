'use client';

import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { useAdminOperation } from '../../hooks/useAdminOperation';
import { settingsSchema, type AdminSettings } from '../../lib/admin-workflow';
import { apiRequest } from '../../lib/api-client';
import { supplyNetworkSettingSchema, type SupplyCountry } from '../../lib/supply-network';
import { AdminOperationFeedback } from './AdminOperationFeedback';

export function SupplyNetworkSettings({ initial, options }: { initial: AdminSettings; options: SupplyCountry[] }) {
  const [countries, setCountries] = useState(initial.supply_network?.value.countries ?? []);
  const [choice, setChoice] = useState('');
  const { operation, state } = useAdminOperation();
  const available = options.filter((option) => !countries.includes(option.country));
  const names = new Map(options.map(({ country, name }) => [country, name]));

  async function refresh() {
    const { data } = await apiRequest('/v1/admin/settings', settingsSchema);
    setCountries(data.supply_network?.value.countries ?? []);
    setChoice('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await operation.run(async () => {
      await apiRequest('/v1/admin/settings', settingsSchema, {
        method: 'PATCH',
        json: { supply_network: supplyNetworkSettingSchema.parse({ countries }) },
      });
    }, refresh);
  }

  return (
    <form className="admin-panel stack-form admin-supply-network" onSubmit={submit} aria-labelledby="supply-network-settings-heading">
      <h2 id="supply-network-settings-heading">Global Supply Network</h2>
      <p className="small muted">Choose the destinations to display on the homepage map. Dhaka is shown as the sourcing hub.</p>
      <fieldset disabled={state.busy || state.blocked || !options.length}>
        <div className="admin-supply-network-picker">
          <label>
            Destination country
            <select value={choice} onChange={(event) => setChoice(event.currentTarget.value)}>
              <option value="">Select a country</option>
              {available.map(({ country, name }) => <option key={country} value={country}>{name}</option>)}
            </select>
          </label>
          <button type="button" className="button secondary" disabled={!choice} onClick={() => {
            setCountries((current) => current.includes(choice) ? current : [...current, choice]);
            setChoice('');
          }}>Add country</button>
        </div>
        {countries.length > 0 && (
          <ul className="admin-supply-network-countries" aria-label="Selected destinations">
            {countries.map((code) => (
              <li key={code}>
                <button type="button" className="button secondary" aria-label={`Remove ${names.get(code) ?? code}`}
                  onClick={() => setCountries((current) => current.filter((country) => country !== code))}>
                  {names.get(code) ?? code}<X size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="button primary" type="submit">Save map destinations</button>
      </fieldset>
      <AdminOperationFeedback state={state} />
      {state.blocked && <button type="button" className="button secondary" disabled={state.busy}
        onClick={() => void operation.refresh(refresh)}>Refresh map destinations</button>}
    </form>
  );
}
