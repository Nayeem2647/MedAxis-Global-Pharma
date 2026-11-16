import { Directory, directoryMetadata, type DirectoryProps } from '../../../components/catalog/Directory';

export async function generateMetadata(props: DirectoryProps) { return directoryMetadata(props, 'categories'); }
export default function Page(props: DirectoryProps) { return <Directory {...props} kind="categories"/>; }
