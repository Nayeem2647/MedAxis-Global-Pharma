import { UtilityPage, utilityMetadata, type UtilityProps } from '../../../components/layout/UtilityPage';
export function generateMetadata(props: UtilityProps) { return utilityMetadata(props, 'privacy'); }
export default function Privacy(props: UtilityProps) { return <UtilityPage {...props} kind="privacy"/>; }
