import type { Metadata } from 'next';
import { CustomerAccess } from '../../../components/customer/CustomerAccess';
export const metadata: Metadata = { title: 'Customer sign in | MedAxis', robots: { index: false, follow: false } };
export default function LoginPage() { return <CustomerAccess mode="login"/>; }
