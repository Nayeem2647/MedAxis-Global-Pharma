import { QuotationViewer } from '../../components/quotation/QuotationViewer';
import { getContactConfig } from '../../lib/public-config';

export default function QuotationNotFound() {
  return <QuotationViewer initial={{ quotation: null, problem: { kind: 'missing', fields: [] } }} contact={getContactConfig()}/>;
}
