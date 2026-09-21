'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TargetDetails, EvidenceValidation, ExternalResponse } from '@/lib/authorized-escalation';
import type { AlertRow } from '@/lib/alerts';
import type { CaseConnectionAnalysis } from '@/lib/case-analysis';
import type { summarizeEvidence } from '@/lib/freeze-hold';

type Evidence = ReturnType<typeof summarizeEvidence>;
export type FreezeHoldPrintPackage = {
  requestId: string; generatedAt: string; status: string; requestedIntervention: string;
  priority: string; targetEntity: string | null; targetEntitySource: string;
  case: { id: string; code: string; title: string; description: string };
  network: string | null; reportedSuspectWallets: string[];
  blockchainObservedFacts: { transactions: Evidence['transactions']; valueUnit: string };
  custodialEndpoints: Evidence['endpoints']; analyticalSignals: Evidence['behavioral'];
  crossWalletEvidence: CaseConnectionAnalysis | null; monitoringAlerts: AlertRow[];
  reason: string; analystNotes: string;
  evidenceReadiness: { percent: number; criteria: Record<string, boolean>; meaning: string };
  auditTrail: { status: string; at: string; note: string; action?: string; source?: string }[];
  preparedAt?: string; targetDetails?: TargetDetails; evidenceValidation?: EvidenceValidation[]; externalResponses?: ExternalResponse[];
  delivery: string; limitations: string[]; notices: string[];
};

const NO_EVIDENCE = 'No blockchain evidence is currently available for this field.';
function Field({ label, value, blockchain = false }: { label: string; value: string | number | null | undefined; blockchain?: boolean }) {
  return <div className="report-field"><dt>{label}</dt><dd>{value === null || value === undefined || value === '' ? (blockchain ? NO_EVIDENCE : 'Unavailable / not provided') : value}</dd></div>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="panel p-5 sm:p-6"><h2>{title}</h2>{children}</section>;
}
// Render structured cross-wallet evidence without truncation or a raw JSON box.
// React escapes all source values, including analyst-entered text.
function EvidenceDetails({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <p>Unavailable</p>;
  if (Array.isArray(value)) return value.length ? <ol>{value.map((item, index) => <li key={index}><EvidenceDetails value={item} /></li>)}</ol> : <p>None in the loaded evidence.</p>;
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key, item]) => <div key={key} className="report-detail"><dt>{key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())}</dt><dd><EvidenceDetails value={item} /></dd></div>)}</dl>;
  return <p>{String(value)}</p>;
}

export function FreezeHoldPrintReport({ data }: { data: FreezeHoldPrintPackage }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // A direct body child ensures hiding the dashboard cannot hide this report.
  // It stays rendered and up to date before the existing window.print() call.
  return mounted ? createPortal(<FreezeHoldPrintDocument data={data} />, document.body) : null;
}

function FullAddress({ address, printable }: { address: string; printable: boolean }) {
  const [message, setMessage] = useState('');
  return <div className="report-address"><span>{address}</span>{!printable && <><button type="button" className="rounded-lg border border-cyan-400/25 px-2 py-1 text-xs text-cyan-200" aria-label={`Copy wallet address ${address}`} onClick={async () => { try { await navigator.clipboard.writeText(address); setMessage('Copied'); } catch { setMessage('Copy unavailable. Select the full address to copy.'); } }}>Copy address</button><span role="status">{message}</span></>}</div>;
}
export function FreezeHoldEvidenceReport({ data }: { data: FreezeHoldPrintPackage }) {
  return <FreezeHoldPrintDocument data={data} printable={false} />;
}
export function FreezeHoldPrintDocument({ data, printable = true }: { data: FreezeHoldPrintPackage; printable?: boolean }) {
  return <article id={printable ? 'freeze-hold-print-report' : 'freeze-hold-evidence-report'} aria-label="CHAINTRACE evidence report">
    <style>{`
      #freeze-hold-print-report { display: none; }
      #freeze-hold-evidence-report { overflow-wrap: anywhere; word-break: break-word; font-size: .875rem; line-height: 1.7; }
      #freeze-hold-evidence-report > * + * { margin-top: 1.25rem; }
      #freeze-hold-evidence-report header, #freeze-hold-evidence-report footer { border-bottom: 1px solid #334155; padding: 1rem 0; }
      #freeze-hold-evidence-report h1 { font-size: 1.5rem; color: white; font-weight: 600; }
      #freeze-hold-evidence-report h2 { font-size: 1.125rem; color: white; font-weight: 600; margin-bottom: 1rem; }
      #freeze-hold-evidence-report h3 { font-weight: 600; color: #e2e8f0; margin: 1rem 0 .5rem; }
      #freeze-hold-evidence-report dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 260px), 1fr)); gap: 1rem; }
      #freeze-hold-evidence-report dt { font-size: .75rem; color: #94a3b8; }
      #freeze-hold-evidence-report dd { white-space: pre-wrap; margin-top: .25rem; color: #e2e8f0; }
      #freeze-hold-evidence-report .report-entry { border: 1px solid #334155; border-radius: .75rem; padding: 1rem; margin-top: .75rem; background: #02061766; }
      #freeze-hold-evidence-report .report-detail { border-left: 1px solid #334155; padding-left: 1rem; min-width: 0; }
      #freeze-hold-evidence-report .report-notices { border: 1px solid #fbbf2440; background: #fbbf2408; padding: 1rem; border-radius: .75rem; color: #fde68a; }
      #freeze-hold-evidence-report p + p { margin-top: .5rem; }
      #freeze-hold-evidence-report ul, #freeze-hold-evidence-report ol { padding-left: 1.25rem; margin: .5rem 0; }
      #freeze-hold-evidence-report ul { list-style: disc; }
      #freeze-hold-evidence-report ol { list-style: decimal; }
      #freeze-hold-evidence-report .report-address { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin: .5rem 0; }
      #freeze-hold-evidence-report .report-address > span:first-child { font-family: monospace; min-width: 0; }
      @media print {
        @page { size: auto; margin: 16mm; }
        html:has(#freeze-hold-print-report), body:has(#freeze-hold-print-report) {
          background: #fff !important; color: #17202a !important; color-scheme: light;
          height: auto !important; min-height: 0 !important; overflow: visible !important;
        }
        body:has(#freeze-hold-print-report) > :not(#freeze-hold-print-report) { display: none !important; }
        body:has(#freeze-hold-print-report)::before, body:has(#freeze-hold-print-report)::after { display: none !important; }
        #freeze-hold-print-report {
          display: block !important; position: static !important; width: auto; margin: 0; padding: 0;
          background: white; color: #17202a; font: 10pt/1.5 Arial, sans-serif;
          height: auto; max-height: none; overflow: visible;
          word-break: break-word; overflow-wrap: anywhere;
        }
        #freeze-hold-print-report * { box-sizing: border-box; max-height: none; overflow: visible; color: inherit !important; background: transparent !important; text-shadow: none; box-shadow: none; }
        #freeze-hold-print-report section { display: block; border: 0; border-radius: 0; padding: 0; margin: 0; }
        #freeze-hold-print-report button { display: none !important; }
        #freeze-hold-print-report header { border-bottom: 2px solid #17202a; padding-bottom: 12pt; margin-bottom: 16pt; }
        #freeze-hold-print-report h1 { font-size: 20pt; font-weight: 700; margin: 3pt 0; }
        #freeze-hold-print-report h2 { font-size: 13pt; font-weight: 700; margin: 18pt 0 8pt; border-bottom: 1px solid #aab4be; padding-bottom: 4pt; break-after: avoid; }
        #freeze-hold-print-report h3 { font-size: 11pt; font-weight: 700; margin: 10pt 0 5pt; break-after: avoid; }
        #freeze-hold-print-report p { margin: 3pt 0 7pt; white-space: pre-wrap; orphans: 3; widows: 3; }
        #freeze-hold-print-report dl { margin: 0; }
        #freeze-hold-print-report dt { font-weight: 700; }
        #freeze-hold-print-report dd { margin: 0 0 6pt; white-space: pre-wrap; }
        #freeze-hold-print-report .report-field { margin-bottom: 5pt; break-inside: avoid; }
        #freeze-hold-print-report .report-entry { border: 1px solid #bdc5ce; padding: 9pt; margin: 8pt 0; break-inside: avoid; }
        #freeze-hold-print-report .report-detail { border-left: 1px solid #bdc5ce; padding-left: 9pt; margin: 6pt 0; }
        #freeze-hold-print-report ol, #freeze-hold-print-report ul { margin: 6pt 0; padding-left: 18pt; list-style-position: outside; }
        #freeze-hold-print-report ol { list-style-type: decimal; }
        #freeze-hold-print-report ul { list-style-type: disc; }
        #freeze-hold-print-report .report-notices { border: 2px solid #465361; padding: 10pt; margin: 12pt 0; font-weight: 600; }
        #freeze-hold-print-report footer { margin-top: 22pt; border-top: 2px solid #17202a; padding-top: 9pt; break-inside: avoid; }
      }
    `}</style>
    <header><p><strong>CHAINTRACE</strong></p><h1>Authorized Freeze/Hold Intelligence</h1><p>Evidence report for authorized review</p><p>{data.delivery}</p></header>
    <div className="report-notices"><p>Risk signals are investigative indicators and are not proof of fraud.</p><p>Wallet connections do not by themselves prove common ownership or coordinated activity.</p><p>CHAINTRACE does not autonomously freeze blockchain assets.</p><p>Any freeze or hold decision remains the responsibility of the authorized receiving entity or competent authority.</p></div>
    <Section title="1. Request Summary"><dl><Field label="Request ID" value={data.requestId} /><Field label="Generation timestamp (UTC)" value={data.generatedAt} /><Field label="CHAINTRACE internal status" value={data.status} /><Field label="Request type" value={data.requestedIntervention} /><Field label="Priority" value={data.priority} /><Field label="Target entity" value={data.targetEntity} /><Field label="Target entity source" value={data.targetEntitySource} /><Field label="Prepared snapshot timestamp" value={data.preparedAt} /></dl></Section>
    <Section title="2. Case Information"><dl><Field label="CHAINTRACE Case ID" value={data.case.id} /><Field label="Case code" value={data.case.code} /><Field label="Case title" value={data.case.title} /><Field label="Network" value={data.network} /><Field label="Case description" value={data.case.description} /></dl></Section>
    <Section title="3. Reported / Suspect Wallets">{data.reportedSuspectWallets.length ? <ul>{data.reportedSuspectWallets.map(address => <li key={address}><FullAddress address={address} printable={printable} /></li>)}</ul> : <p>No reported wallet addresses available.</p>}</Section>
    <Section title="4. Blockchain Evidence"><p><strong>Transactions analyzed in the loaded package: {data.blockchainObservedFacts.transactions.length}</strong></p><p>Loaded transaction evidence only. Failed or unknown receipt statuses do not confirm that funds moved.</p>{data.blockchainObservedFacts.transactions.length ? data.blockchainObservedFacts.transactions.map((tx, index) => <div className="report-entry" key={tx.hash}><h3>Transaction {index + 1}</h3><dl><Field blockchain label="Full transaction hash" value={tx.hash} /><Field blockchain label="From" value={tx.from} /><Field blockchain label="To" value={tx.to} /><Field blockchain label={`Value (${data.blockchainObservedFacts.valueUnit})`} value={tx.value} /><Field blockchain label="Timestamp (UTC)" value={tx.timestamp} /><Field blockchain label="Receipt status" value={tx.status} /><Field blockchain label="Block number" value={tx.blockNumber} /></dl></div>) : <p>{NO_EVIDENCE}</p>}<h3>Observed destinations / fund-flow evidence</h3><p>These destinations were identified by the existing analysis from successful outgoing nonzero value transfers. Full sender, recipient, value and receipt information appears above.</p>{data.custodialEndpoints.length ? <ul>{data.custodialEndpoints.map(endpoint => <li key={endpoint.address}>{endpoint.address}</li>)}</ul> : <p>{NO_EVIDENCE}</p>}</Section>
    <Section title="5. Money Fingerprint">{!data.analyticalSignals.length && <p>{NO_EVIDENCE}</p>}{data.analyticalSignals.map(row => <div key={row.address}><h3>Wallet: {row.address}</h3><dl><Field label="Source" value={row.source} /><Field label="Retrieved at (UTC)" value={row.retrievedAt} /></dl><h3>Money Fingerprint</h3>{row.moneyFingerprint ? <dl><Field label="Incoming ETH" value={row.moneyFingerprint.incomingEth} /><Field label="Outgoing ETH" value={row.moneyFingerprint.outgoingEth} /><Field label="Unique counterparties" value={row.moneyFingerprint.counterparties} /><Field label="Transfers per day" value={row.moneyFingerprint.transfersPerDay} /><Field label="Average transfer (ETH)" value={row.moneyFingerprint.averageEth} /><Field label="Largest transfer (ETH)" value={row.moneyFingerprint.largestEth} /></dl> : <p>Unavailable: no successful transfers in this sample.</p>}<h3>Behavioral / risk signals</h3>{row.riskSignals.length ? <ul>{row.riskSignals.map((signal, index) => <li key={index}>{signal}</li>)}</ul> : <p>No signals in the loaded analysis.</p>}</div>)}
      </Section>
    <Section title="6. Fund Splitting"><p>Fund Splitting findings are analytical signals, not proof of fraud.</p>{!data.analyticalSignals.length && <p>{NO_EVIDENCE}</p>}{data.analyticalSignals.map(row => <div className="report-entry" key={row.address}><h3>Wallet: {row.address}</h3><h3>Fund Splitting findings</h3>{row.fundSplitting ? <><dl><Field label="Window start" value={row.fundSplitting.start} /><Field label="Window end" value={row.fundSplitting.end} /><Field label="Transaction count" value={row.fundSplitting.transactionCount} /><Field label="Destination count" value={row.fundSplitting.destinationCount} /><Field label="Total value (wei)" value={row.fundSplitting.totalWei} /></dl><p>Supporting transaction hashes:</p><ul>{row.fundSplitting.transactionHashes.map(hash => <li key={hash}>{hash}</li>)}</ul></> : <p>No Fund Splitting finding in this sample.</p>}</div>)}</Section>
    <Section title="7. Cross-Wallet Intelligence"><h3>Cross-wallet evidence</h3>{data.crossWalletEvidence ? <EvidenceDetails value={data.crossWalletEvidence} /> : <p>{NO_EVIDENCE}</p>}
      </Section>
    <Section title="8. Custodial Endpoint Intelligence"><p>Attribution is not proof of fraud and does not give CHAINTRACE control over assets.</p>{data.custodialEndpoints.length ? data.custodialEndpoints.map(endpoint => <div className="report-entry" key={endpoint.address}><dl><Field label="Wallet address" value={endpoint.address} /><Field label="Attribution status / confidence" value={endpoint.status} /></dl><p>{endpoint.attribution}</p>{endpoint.record && <dl><Field label="Entity name" value={endpoint.record.entityName} /><Field label="Entity type" value={endpoint.record.entityType} /><Field label="Attribution network" value={endpoint.network} /><Field label="Evidence / source" value={endpoint.record.sourceName} /><Field label="Source reference / URL" value={endpoint.record.sourceReference} /><Field label="Verification date" value={endpoint.record.verifiedAt} /><Field label="Record ID" value={endpoint.record.id} /><Field label="Attribution notes" value={endpoint.record.notes} /></dl>}{endpoint.possibleRecords?.map(record => <div key={record.id}><p>POSSIBLE / UNVERIFIED - not verified ownership.</p><dl><Field label="Possible entity" value={record.entityName} /><Field label="Entity type" value={record.entityType} /><Field label="Evidence / source" value={record.sourceName} /><Field label="Source reference / URL" value={record.sourceReference} /><Field label="Verification date" value={record.verifiedAt} /><Field label="Notes" value={record.notes} /></dl></div>)}{endpoint.status !== 'VERIFIED' && <p>No verified custodial attribution is currently available.</p>}</div>) : <p>No verified custodial attribution is currently available.</p>}</Section>
    <Section title="9. Monitoring / Alert Evidence">{data.monitoringAlerts.length ? data.monitoringAlerts.map(alert => <div className="report-entry" key={alert.id}><h3>{alert.title}</h3><p>{alert.description}</p><dl><Field label="Alert ID" value={alert.id} /><Field label="Wallet" value={alert.wallet} /><Field label="Transaction hash" value={alert.source_transaction_hash} /><Field label="Detected at (UTC)" value={alert.created_at} /><Field label="Severity" value={alert.severity} /><Field label="Status" value={alert.status} /><Field label="Stored analytical risk score (not proof of fraud)" value={alert.risk_score} /></dl></div>) : <p>No monitoring alerts included in the loaded package.</p>}
    </Section>
    <Section title="10. Evidence Readiness"><p><strong>{data.evidenceReadiness.percent}% — evidence completeness, NOT probability of fraud.</strong></p><p>Evidence Readiness measures evidence completeness and is not a probability of fraud.</p><p>Evidence Readiness measures package completeness. It is not a probability of fraud.</p>{data.evidenceValidation && <><h3>Escalation validation</h3><dl>{data.evidenceValidation.map(row => <Field key={row.label} label={row.label + (row.required ? " (required)" : " (optional)")} value={row.state + " - " + row.explanation} />)}</dl></>}<p>{data.evidenceReadiness.meaning}</p><dl>{Object.entries(data.evidenceReadiness.criteria).map(([label, available]) => <Field key={label} label={label} value={available ? 'Available' : 'Unavailable / not observed'} />)}</dl></Section>
    <Section title="11. Authorized Intervention"><dl><Field label="Reason for request" value={data.reason} /><Field label="Investigator notes" value={data.analystNotes} /><Field label="Requested intervention" value={data.requestedIntervention} /><Field label="Priority" value={data.priority} /><Field label="Target entity" value={data.targetEntity} /><Field label="CHAINTRACE internal status" value={data.status} /></dl><p>Prepared for Authorized Escalation describes internal package preparation, not external delivery.</p><p>{data.delivery}</p>{data.targetDetails && <><h3>Target Entity</h3><p>{data.targetDetails.source || "ANALYST-ENTERED / UNVERIFIED"}</p>{!data.targetDetails.verifiedEndpoint && <p>Analyst-entered - not blockchain-verified attribution.</p>}<dl><Field label="Entity type" value={data.targetDetails.entityType} /><Field label="Target attribution status" value={data.targetDetails.attributionStatus} /><Field label="Supporting source/reference" value={data.targetDetails.attributionReference} /><Field label="Contact / reference" value={data.targetDetails.contactReference} />{data.targetDetails.verifiedEndpoint?.record && <><Field label="Verified target address" value={data.targetDetails.verifiedEndpoint.address} /><Field label="Verified target network" value={data.targetDetails.verifiedEndpoint.network} /><Field label="Attribution source" value={data.targetDetails.verifiedEndpoint.record.sourceName} /><Field label="Attribution source reference / URL" value={data.targetDetails.verifiedEndpoint.record.sourceReference} /><Field label="Verified at" value={data.targetDetails.verifiedEndpoint.record.verifiedAt} /></>}</dl></>}<h3>External Response Status</h3>{data.externalResponses?.length ? data.externalResponses.map((response, index) => <div className="report-entry" key={index}><p>Analyst recorded; not independently verified by CHAINTRACE.</p><dl><Field label="External status" value={response.status} /><Field label="External Reference ID" value={response.referenceId} /><Field label="Responding entity" value={response.entity} /><Field label="Response timestamp (UTC)" value={response.respondedAt} /><Field label="Recorded timestamp (UTC)" value={response.recordedAt} /><Field label="Analyst confirmation" value={response.confirmed ? 'Confirmed by analyst as based on an external response' : 'Not confirmed'} /><Field label="Response notes" value={response.notes} /></dl></div>) : <p>No external response recorded.</p>}<p>External submission is performed through an authorized channel outside CHAINTRACE unless an approved integration is configured.</p></Section>
    <Section title="12. Important Findings / Limitations"><ul>{data.limitations.map((item, index) => <li key={index}>{item}</li>)}</ul><h3>Workflow audit trail</h3>{data.auditTrail.map((entry, index) => <div className="report-entry" key={index}><dl><Field label="Timestamp (UTC)" value={entry.at} />{entry.action && <Field label="Action" value={entry.action} />}{entry.source && <Field label="Source" value={entry.source} />}<Field label="Recorded status (see action/source)" value={entry.status} /><Field label="Update / analyst-reported correspondence" value={entry.note} /></dl></div>)}<div className="report-notices">{data.notices.map(notice => <p key={notice}>{notice}</p>)}</div></Section>
    <footer><strong>Generated by CHAINTRACE — NODEHIVE</strong><p>Blockchain Investigation &amp; Authorized Intervention Intelligence</p></footer>
  </article>;
}



