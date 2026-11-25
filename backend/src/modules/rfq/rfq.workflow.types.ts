export interface OfferMessage {
  id: string;
  operation_id: string;
  fingerprint: string;
  author: 'BUYER' | 'ADMIN';
  kind: 'REQUEST' | 'REVISED' | 'COUNTEROFFER' | 'RETAINED';
  body: string;
  version_id: string;
  version_number: number;
  created_at: string;
  scope?: 'MEDICINE' | 'DELIVERY' | 'BOTH';
  proposed_medicine_subtotal?: string;
  proposed_delivery_charge?: string;
  request_id?: string;
}
export interface RfqWorkflow {
  enabled: boolean;
  reviewed_at?: string;
  reviewed_by?: string;
  pending_request_id?: string;
  offer_state?: 'CHANGE_REQUESTED' | 'REVISED' | 'COUNTEROFFER' | 'RETAINED';
  messages?: OfferMessage[];
}
