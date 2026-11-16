import { Hub, hubMetadata, type HubProps } from '../../../../components/catalog/Hub';
import { catalogStaticParams } from '../../../../lib/catalog-data';
import { isLocale } from '../../../../i18n/routing';

export const revalidate = 3600;
export const dynamicParams = true;
export async function generateStaticParams({ params }: { params: { locale: string } }) { return isLocale(params.locale) ? catalogStaticParams('generics', params.locale) : []; }
export async function generateMetadata(props: HubProps) { return hubMetadata(props, 'generics'); }
export default function Page(props: HubProps) { return <Hub {...props} kind="generics"/>; }
