'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { z } from 'zod';
import { customerRequest } from '../../lib/customer-api';
import { customerSessionSchema, type CustomerProfile } from '../../lib/customer-contract';

interface AccountContext { profile: CustomerProfile | null; loading: boolean; refresh(): Promise<void>; logout(): Promise<void> }
const Context = createContext<AccountContext | null>(null);
export function CustomerAccountProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++revision.current;
    try { const result = await customerRequest('auth/session', customerSessionSchema); if (request === revision.current) setProfile(result.data.profile); }
    catch { if (request === revision.current) setProfile(null); }
    finally { if (request === revision.current) setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, pathname]);
  const logout = useCallback(async () => {
    await customerRequest('auth/logout', z.object({ logged_out: z.literal(true) }), { method: 'POST', body: {} });
    revision.current += 1;
    setProfile(null);
  }, []);
  return <Context.Provider value={{ profile, loading, refresh, logout }}>{children}</Context.Provider>;
}
export function useCustomerAccount() {
  const context = useContext(Context);
  if (!context) throw new Error('Customer account context is unavailable.');
  return context;
}
