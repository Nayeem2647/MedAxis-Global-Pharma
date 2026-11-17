/** Only a signal crosses tabs; cookies and enrollment material never do. */
export function notifyAdminSessionChange() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel('medaxis-admin-session');
  channel.postMessage('recheck');
  channel.close();
}
