import { notFound } from 'next/navigation';
import { GuestWorkflowViewer } from '../../../components/quotation/GuestWorkflowViewer';
export default async function PrivateRequest({ params }: { params: Promise<{ token: string }> }) { const { token } = await params; if (!/^[a-f0-9]{64}$/.test(token)) notFound(); return <GuestWorkflowViewer token={token}/>; }
