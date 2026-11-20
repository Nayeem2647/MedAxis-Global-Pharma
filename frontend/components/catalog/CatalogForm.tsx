'use client';

import { useEffect, useTransition, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

let reloadHandled = false;

export function CatalogForm({
  action,
  className,
  label,
  loadingLabel,
  children,
  search = false,
  autoSubmitOnSelect = false,
}: {
  action: string;
  className: string;
  label: string;
  loadingLabel: string;
  children: ReactNode;
  search?: boolean;
  autoSubmitOnSelect?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!autoSubmitOnSelect || reloadHandled) return;
    reloadHandled = true;
    const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (entry?.type === 'reload' && window.location.search) {
      startTransition(() => router.replace(action));
    }
  }, [action, autoSubmitOnSelect, router]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parameters = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === 'string' && value.trim()) parameters.set(key, value.trim());
    }
    const query = parameters.toString();
    startTransition(() => router.push(query ? `${action}?${query}` : action));
  }

  function handleChange(event: ChangeEvent<HTMLFormElement>) {
    if (autoSubmitOnSelect && event.target instanceof HTMLSelectElement) {
      event.currentTarget.requestSubmit();
    }
  }

  return (
    <form
      action={action}
      method="get"
      className={className}
      aria-label={label}
      role={search ? 'search' : undefined}
      aria-busy={pending}
      onSubmit={submit}
      onChange={handleChange}
    >
      {children}
      {pending && <p className="catalog-pending" role="status">{loadingLabel}</p>}
    </form>
  );
}
