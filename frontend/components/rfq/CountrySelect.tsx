'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, X } from 'lucide-react';
import { countryCodes } from '../../lib/rfq';

export interface CountryOption {
  code: string;
  name: string;
}

export function buildCountryOptions(locale: string): CountryOption[] {
  let display: Intl.DisplayNames | undefined;
  try {
    display = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    display = undefined;
  }
  return [...countryCodes]
    .map((code) => ({ code, name: display?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function findExactCountry(options: readonly CountryOption[], raw: string): CountryOption | undefined {
  const q = raw.trim().toLowerCase();
  if (!q) return undefined;
  return options.find((opt) => opt.code.toLowerCase() === q || opt.name.toLowerCase() === q);
}

export function CountrySelect({
  id,
  name = 'destination_country',
  value,
  options,
  placeholder,
  emptyLabel,
  invalid,
  describedBy,
  required,
  disabled,
  onChange,
}: {
  id: string;
  name?: string;
  value: string;
  options: readonly CountryOption[];
  placeholder: string;
  emptyLabel: string;
  invalid?: boolean;
  describedBy?: string;
  required?: boolean;
  disabled?: boolean;
  onChange(code: string): void;
}) {
  const listboxId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedOption = useMemo(
    () => options.find((opt) => opt.code === value),
    [options, value],
  );

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) => opt.name.toLowerCase().includes(q) || opt.code.toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(event: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        const match = findExactCountry(options, query);
        if (match && match.code !== value) onChange(match.code);
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [open, options, query, value, onChange]);

  function selectOption(code: string) {
    onChange(code);
    setOpen(false);
    setQuery('');
  }

  function handleClear() {
    onChange('');
    setQuery('');
    setOpen(true);
    setHighlighted(0);
    inputRef.current?.focus();
  }

  const displayValue = open ? query : (selectedOption?.name ?? '');

  return (
    <div ref={wrapRef} className="rfq-country-combobox">
      <div className="rfq-country-input-wrap">
        <input
          ref={inputRef}
          id={id}
          type="text"
          className="rfq-field-input rfq-country-input"
          role="combobox"
          autoComplete="country-name"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          required={required}
          placeholder={selectedOption ? selectedOption.name : placeholder}
          value={displayValue}
          disabled={disabled}
          onFocus={() => {
            setQuery('');
            setOpen(true);
            setHighlighted(0);
          }}
          onChange={(e) => {
            const nextQuery = e.target.value;
            setQuery(nextQuery);
            setOpen(true);
            setHighlighted(0);
            if (!nextQuery.trim()) {
              if (value) onChange('');
              return;
            }
            const exact = findExactCountry(options, nextQuery);
            if (exact) onChange(exact.code);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (!open) setOpen(true);
              setHighlighted((prev) => Math.min(prev + 1, Math.max(0, filtered.length - 1)));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setHighlighted((prev) => Math.max(0, prev - 1));
            } else if (e.key === 'Enter') {
              if (open && filtered.length > 0) {
                e.preventDefault();
                const picked = filtered[highlighted] ?? filtered[0];
                if (picked) selectOption(picked.code);
              }
            } else if (e.key === 'Escape') {
              setOpen(false);
              setQuery('');
            }
          }}
        />
        <input type="hidden" name={name} value={value} readOnly />

        {value && !disabled ? (
          <button
            type="button"
            className="rfq-country-icon-btn"
            aria-label="Clear country"
            onClick={handleClear}
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="rfq-country-icon-btn"
            tabIndex={-1}
            aria-label="Toggle country list"
            disabled={disabled}
            onClick={() => {
              if (open) {
                setOpen(false);
                setQuery('');
              } else {
                setQuery('');
                setOpen(true);
                inputRef.current?.focus();
              }
            }}
          >
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        )}
      </div>

      {open && (
        <ul id={listboxId} className="rfq-country-dropdown" role="listbox" aria-label={placeholder}>
          {filtered.length > 0 ? (
            filtered.map((opt, idx) => {
              const isSelected = opt.code === value;
              const isActive = idx === highlighted;
              return (
                <li
                  key={opt.code}
                  role="option"
                  aria-selected={isSelected}
                  className={`rfq-country-option${isActive ? ' is-highlighted' : ''}${isSelected ? ' is-selected' : ''}`}
                  onMouseEnter={() => setHighlighted(idx)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    selectOption(opt.code);
                  }}
                >
                  <span className="rfq-country-option-name">{opt.name}</span>
                  <span className="rfq-country-option-right">
                    <span className="rfq-country-code-tag">{opt.code}</span>
                    {isSelected && <Check size={14} aria-hidden="true" />}
                  </span>
                </li>
              );
            })
          ) : (
            <li className="rfq-country-empty">{emptyLabel}</li>
          )}
        </ul>
      )}
    </div>
  );
}
