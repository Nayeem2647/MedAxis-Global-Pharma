import {
  QuotationDirectory,
  type QuotationSearch,
} from "../../../../components/admin/QuotationDirectory";
export default function QuotationsPage({
  searchParams,
}: {
  searchParams: QuotationSearch;
}) {
  return <QuotationDirectory searchParams={searchParams} />;
}
