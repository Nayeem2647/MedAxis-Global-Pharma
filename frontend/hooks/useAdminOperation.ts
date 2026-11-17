'use client';
import { useState, useSyncExternalStore } from 'react';
import { AdminOperation } from '../lib/admin-workflow';
export function useAdminOperation() { const [operation] = useState(() => new AdminOperation()); const state = useSyncExternalStore(operation.subscribe, operation.getSnapshot, operation.getSnapshot); return { operation, state }; }
