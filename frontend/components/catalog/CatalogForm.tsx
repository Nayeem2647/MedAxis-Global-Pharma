'use client';

import { useTransition, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

export function CatalogForm({ action, className, label, loadingLabel, children, search = false }: { action: string; className: string; label: string; loadingLabel: string; children: ReactNode; search?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parameters = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget)) {
      if (typeof value === 'string' && value.trim()) parameters.set(key, value.trim());
    }
    const query = parameters.toString();
    startTransition(() => router.push(query ? `${action}?${query}` : action));
  }
  return <form action={action} method="get" className={className} aria-label={label} role={search ? 'search' : undefined} aria-busy={pending} onSubmit={submit}>
    {children}{pending && <p className="catalog-pending" role="status">{loadingLabel}</p>}
  </form>;
}
