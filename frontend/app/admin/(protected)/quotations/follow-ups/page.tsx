import {
  QuotationDirectory,
  type QuotationSearch,
} from "../../../../../components/admin/QuotationDirectory";
export default function QuotationFollowUps({
  searchParams,
}: {
  searchParams: QuotationSearch;
}) {
  return <QuotationDirectory searchParams={searchParams} followUps />;
}
