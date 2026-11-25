import { QuotationDirectory } from '../../../../../components/admin/QuotationDirectory';
export default function IssuedDocuments({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { return <QuotationDirectory searchParams={searchParams}/>; }
