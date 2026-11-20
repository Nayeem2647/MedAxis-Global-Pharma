import type { Metadata } from 'next';
import { CustomerAccess } from '../../../components/customer/CustomerAccess';
export const metadata: Metadata = { title: 'Create customer account | MedAxis', robots: { index: false, follow: false } };
export default function RegistrationPage() { return <CustomerAccess mode="register"/>; }
