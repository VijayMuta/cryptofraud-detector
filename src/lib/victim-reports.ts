import { isEthereumAddress } from '@/lib/ethereum-address';

export const INCIDENT_TYPES = ['Investment scam', 'Impersonation scam', 'Phishing', 'Romance scam', 'Fake exchange/platform', 'Wallet compromise', 'Fraudulent payment', 'Other'] as const;
export const REPORT_STATUSES = ['submitted', 'under_review', 'investigating', 'closed'] as const;
export const STATUS_LABELS = { submitted: 'Submitted', under_review: 'Under Review', investigating: 'Investigating', closed: 'Closed' } as const;
export type ReportStatus = typeof REPORT_STATUSES[number];
export type ReportInput = {
  suspect_wallet: string; network: 'ethereum'; incident_type: string; approximate_loss: string; loss_currency: string;
  incident_date: string; transaction_hash: string; reported_service: string; description: string; reference: string; additional_notes: string;
};
export type VictimReport = ReportInput & { id: string; status: ReportStatus; created_at: string; updated_at: string };
export const REPORT_FIELDS = 'id,suspect_wallet,network,incident_type,approximate_loss,loss_currency,incident_date,transaction_hash,reported_service,description,reference,additional_notes,status,created_at,updated_at';
export const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validateReport(input: unknown): { data?: ReportInput; error?: string } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Enter valid report details.' };
  const body = input as Record<string, unknown>;
  const text = (key: string) => typeof body[key] === 'string' ? body[key].trim() : '';
  const wallet = text('suspect_wallet'), hash = text('transaction_hash');
  if (!isEthereumAddress(wallet)) return { error: 'Enter a valid Ethereum wallet address (including its checksum for mixed-case addresses).' };
  if (text('network') !== 'ethereum') return { error: 'Only Ethereum Mainnet reports are currently supported.' };
  if (!(INCIDENT_TYPES as readonly string[]).includes(text('incident_type'))) return { error: 'Choose an incident type. This records an allegation, not a finding.' };
  const loss = text('approximate_loss');
  if (!/^(0|[1-9]\d{0,17})(\.\d{1,18})?$/.test(loss)) return { error: 'Enter a non-negative loss amount, with up to 18 digits before and after the decimal point.' };
  const currency = text('loss_currency').toUpperCase();
  if (!/^[A-Z][A-Z0-9]{1,11}$/.test(currency)) return { error: 'Enter a currency or token symbol of 2–12 letters/digits, such as ETH, USD or USDT.' };
  const date = text('incident_date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date || date < '2009-01-01' || date > new Date().toISOString().slice(0, 10)) return { error: 'Enter a valid incident date from 2009 through today (UTC).' };
  if (hash && !/^0x[0-9a-f]{64}$/i.test(hash)) return { error: 'Transaction hash must be 0x followed by 64 hexadecimal characters.' };
  if (text('description').length < 10 || text('description').length > 5000) return { error: 'Describe the incident in 10–5,000 characters.' };
  for (const [key, max] of [['reported_service', 200], ['reference', 200], ['additional_notes', 2000]] as const) if (text(key).length > max) return { error: `${key.replace(/_/g, ' ')} must be ${max} characters or fewer.` };
  return { data: { suspect_wallet: wallet.toLowerCase(), network: 'ethereum', incident_type: text('incident_type'), approximate_loss: loss, loss_currency: currency, incident_date: date, transaction_hash: hash.toLowerCase(), reported_service: text('reported_service'), description: text('description'), reference: text('reference'), additional_notes: text('additional_notes') } };
}
export function reportInvestigationUrl(report: Pick<VictimReport, 'suspect_wallet'>) { return `/investigate?address=${encodeURIComponent(report.suspect_wallet)}`; }
export function reportCaseDraft(report: VictimReport) {
  return { title: `Reported incident ${report.id}`, wallet: report.suspect_wallet, description: `Source intake report: ${report.id}\nVictim-provided allegation; not blockchain verification.\nReported incident type: ${report.incident_type}\nReported date: ${report.incident_date}\nReported loss: ${report.approximate_loss} ${report.loss_currency}\nReview the private intake report before adding further information.` };
}
