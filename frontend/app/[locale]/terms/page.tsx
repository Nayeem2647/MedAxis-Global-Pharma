import { UtilityPage, utilityMetadata, type UtilityProps } from '../../../components/layout/UtilityPage';
export function generateMetadata(props: UtilityProps) { return utilityMetadata(props, 'terms'); }
export default function Terms(props: UtilityProps) { return <UtilityPage {...props} kind="terms"/>; }
