import { ServicePage, serviceMetadata, type ServiceProps } from '../../../components/catalog/ServicePage';

export async function generateMetadata(props: ServiceProps) { return serviceMetadata(props); }
export default function Page(props: ServiceProps) { return <ServicePage {...props}/>; }
