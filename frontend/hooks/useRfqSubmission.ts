'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { RfqSubmission } from '../lib/rfq';

export function useRfqSubmission() {
  const [submission] = useState(() => new RfqSubmission());
  const state = useSyncExternalStore(submission.subscribe, submission.getSnapshot, submission.getSnapshot);
  const locked = submission.locked;
  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [locked]);
  return { state, locked, isLocked: () => submission.locked, submit: submission.submit.bind(submission), reconcile: submission.reconcile.bind(submission) };
}
