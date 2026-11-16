import { notFound } from 'next/navigation';
import { QuotationViewer } from '../../../components/quotation/QuotationViewer';
import { quotationProblem, quotationToken, readQuotation, type QuotationInitial } from '../../../lib/quotation';
import { getContactConfig } from '../../../lib/public-config';

export default async function QuotationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!quotationToken.safeParse(token).success) notFound();
  let initial: QuotationInitial;
  try { initial = { quotation: await readQuotation(token), problem: null }; }
  catch (error: unknown) {
    const problem = quotationProblem(error);
    if (problem.kind === 'missing') notFound();
    initial = { quotation: null, problem };
  }
  return <QuotationViewer key={token} token={token} initial={initial} contact={getContactConfig()}/>;
}
