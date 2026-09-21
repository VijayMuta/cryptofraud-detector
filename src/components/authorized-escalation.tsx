'use client';
import { useState } from 'react';
import { ENTITY_TYPES, EXTERNAL_STATUSES, ESCALATION_NOTICE, SUBMISSION_NOTICE, type AuditEntry, type EvidenceValidation, type ExternalResponse, type InternalStatus, type TargetDetails } from '@/lib/authorized-escalation';

const input = 'mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white';
const button = 'rounded-xl border border-cyan-400/25 bg-cyan-400/[0.06] px-4 py-2.5 text-sm text-cyan-100 disabled:opacity-40';
type Props = {
  status: InternalStatus; busy: boolean; message: string; target: string; setTarget: (value: string) => void;
  targetDetails: TargetDetails; setTargetDetails: (value: TargetDetails) => void;
  validation: EvidenceValidation[]; notApplicable: Record<string, string>; setNotApplicable: (value: Record<string, string>) => void;
  audit: AuditEntry[]; responses: ExternalResponse[]; preparedAt?: string;
  onValidate: () => void; onStatus: (status: InternalStatus) => void;
  onResponse: (response: Omit<ExternalResponse, 'recordedAt' | 'source'>) => boolean;
};
export function AuthorizedEscalation(props: Props) {
  const { status, busy, targetDetails, validation } = props;
  const [response, setResponse] = useState<Omit<ExternalResponse, 'recordedAt' | 'source'>>({ referenceId: '', entity: '', respondedAt: '', status: 'ACKNOWLEDGED', notes: '', confirmed: false });
  const editable = status === 'DRAFT' && !busy;
  const prepared = !!props.preparedAt;
  return <section className="panel space-y-6 p-5 sm:p-6" aria-label="Authorized Escalation">
    <h2 className="text-xl font-semibold text-white">Authorized Escalation</h2><p role="status" className="text-sm text-cyan-200">{props.message}</p>
    <p className="rounded-xl border border-amber-400/25 p-4 text-sm text-amber-200">{ESCALATION_NOTICE}</p>
    <p className="text-xs text-amber-200">Session-local prototype: export before switching cases, navigating away, or reloading. No database audit or external delivery integration is configured.</p>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-xl border border-cyan-400/25 p-4"><h3 className="text-xs font-semibold text-cyan-200">CHAINTRACE INTERNAL STATUS</h3><p className="mt-2 text-sm">{status}</p><p className="mt-3 text-xs leading-6">Investigation → Evidence Validation → Ready for Review → Prepared for Authorized Escalation</p>{props.preparedAt && <p className="mt-2 text-xs">Snapshot prepared: {props.preparedAt}</p>}</div>
      <div className="rounded-xl border border-violet-400/25 p-4"><h3 className="text-xs font-semibold text-violet-200">EXTERNAL RESPONSE STATUS</h3><p className="mt-2 text-sm">{props.responses.length ? `${props.responses[props.responses.length - 1].status} (analyst recorded)` : 'No external response recorded'}</p><p className="mt-3 text-xs leading-6">Authorized External Channel → External Review → Outcome Recorded</p><p className="mt-2 text-xs">CHAINTRACE does not independently verify external responses.</p></div>
    </div>
    <h3 className="font-semibold text-white">Target Entity</h3>
    <fieldset disabled={!editable} className="grid gap-4 md:grid-cols-2">
      <label className="text-sm">Entity Name<input className={input} maxLength={200} value={props.target} onChange={e => props.setTarget(e.target.value)} /></label>
      <label className="text-sm">Entity Type<select className={input} value={targetDetails.entityType} onChange={e => props.setTargetDetails({ ...targetDetails, entityType: e.target.value })}>{ENTITY_TYPES.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-sm">Attribution Status (analyst assessment)<select className={input} value={targetDetails.attributionStatus} onChange={e => props.setTargetDetails({ ...targetDetails, attributionStatus: e.target.value as TargetDetails['attributionStatus'] })}>{['UNVERIFIED / MANUAL ENTRY', 'POSSIBLE', 'VERIFIED'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="text-sm">Contact / Reference (optional)<input maxLength={1000} className={input} value={targetDetails.contactReference} onChange={e => props.setTargetDetails({ ...targetDetails, contactReference: e.target.value })} /></label>
      {targetDetails.attributionStatus !== 'UNVERIFIED / MANUAL ENTRY' && <label className="text-sm md:col-span-2">Supporting attribution source/reference (required for this assessment)<input maxLength={2000} className={input} value={targetDetails.attributionReference} onChange={e => props.setTargetDetails({ ...targetDetails, attributionReference: e.target.value })} /></label>}
    </fieldset>
    <p className="text-xs text-amber-200">Analyst-entered — not blockchain-verified attribution. No verified custodial attribution is currently available. This assessment never changes blockchain endpoint labels.</p>
    <h3 className="font-semibold text-white">Evidence Validation</h3>
    <p className="text-sm">{validation.filter(row => row.state === 'AVAILABLE').length} / {validation.length} evidence categories available. Missing optional findings do not block preparation. Mark an optional category not applicable only with an explanation.</p>
    <p className="text-xs">Evidence Readiness measures package completeness. It is not a probability of fraud.</p>
    <div className="grid gap-3 md:grid-cols-2">{validation.map(row => <div key={row.label} className="rounded-xl border border-slate-800 p-3"><div className="flex flex-wrap justify-between gap-2 text-sm"><span>{row.label}{row.required ? ' *' : ''}</span><strong className={row.state === 'AVAILABLE' ? 'text-emerald-200' : 'text-amber-200'}>{row.state}</strong></div><p className="mt-2 text-xs text-slate-400">{row.explanation}</p>{!row.required && row.state !== 'AVAILABLE' && <label className="mt-2 block text-xs">Not applicable explanation (optional)<input disabled={!editable} className={input} maxLength={1000} value={props.notApplicable[row.label] || ''} onChange={e => props.setNotApplicable({ ...props.notApplicable, [row.label]: e.target.value })} /></label>}</div>)}</div>
    <div className="flex flex-wrap gap-3"><button className={button} disabled={busy || status === 'CLOSED'} onClick={props.onValidate}>Check evidence readiness</button><button className={button} disabled={busy || status !== 'DRAFT'} onClick={() => props.onStatus('READY FOR REVIEW')}>Mark Ready for Review</button><button className={button} disabled={busy || prepared || status === 'CLOSED'} onClick={() => props.onStatus('PREPARED FOR AUTHORIZED ESCALATION')}>Prepare for Authorized Escalation</button>{status === 'READY FOR REVIEW' && <button className={button} disabled={busy} onClick={() => props.onStatus('DRAFT')}>Return to Draft</button>}{prepared && status !== 'CLOSED' && <button className={button} disabled={busy} onClick={() => props.onStatus('CLOSED')}>Close Internal Workflow</button>}</div>
    <p className="text-xs">Preparation locks a snapshot of the evidence and request fields. Internal closure does not assert any external outcome.</p>
    <div className="space-y-4 rounded-xl border border-violet-400/25 p-4"><h3 className="font-semibold text-white">Record External Response</h3><p className="text-xs">Record verified information received outside CHAINTRACE after preparing the package. No acknowledgement is generated automatically.</p>
      <fieldset disabled={!prepared || status === 'CLOSED' || busy} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">External Reference ID<input maxLength={200} className={input} value={response.referenceId} onChange={e => setResponse({ ...response, referenceId: e.target.value })} /></label>
        <label className="text-sm">Responding Entity<input maxLength={200} className={input} value={response.entity} onChange={e => setResponse({ ...response, entity: e.target.value })} /></label>
        <label className="text-sm">Response Date/Time (your local time)<input type="datetime-local" className={input} value={response.respondedAt} onChange={e => setResponse({ ...response, respondedAt: e.target.value })} /></label>
        <label className="text-sm">Response Status<select className={input} value={response.status} onChange={e => setResponse({ ...response, status: e.target.value as ExternalResponse['status'] })}>{EXTERNAL_STATUSES.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm md:col-span-2">Notes<textarea maxLength={10000} rows={3} className={input} value={response.notes} onChange={e => setResponse({ ...response, notes: e.target.value })} /></label>
        <label className="flex items-start gap-2 text-sm md:col-span-2"><input type="checkbox" checked={response.confirmed} onChange={e => setResponse({ ...response, confirmed: e.target.checked })} />I confirm that this status is based on an external response and is not automatically generated by CHAINTRACE.</label>
        <button type="button" className={button} onClick={() => { if (props.onResponse(response)) setResponse({ referenceId: '', entity: '', respondedAt: '', status: 'ACKNOWLEDGED', notes: '', confirmed: false }); }}>Record External Response</button>
      </fieldset>
      {props.responses.map((entry, index) => <div key={index} className="rounded-lg border border-slate-700 p-3 text-xs"><p>{entry.status} — Analyst recorded</p><p>{entry.entity} · Reference: {entry.referenceId}</p><p>Response: {entry.respondedAt} · Recorded: {entry.recordedAt}</p><p className="whitespace-pre-wrap">{entry.notes}</p></div>)}
    </div>
    <h3 className="font-semibold text-white">Audit Trail</h3><ol className="space-y-2">{props.audit.map((entry, index) => <li key={index} className="rounded-lg border border-slate-800 p-3 text-xs"><time>{entry.at}</time><p>{entry.action} · {entry.status} · {entry.source}</p><p className="whitespace-pre-wrap">{entry.note}</p></li>)}</ol>
    <h3 className="font-semibold text-white">Export for Authorized Submission</h3><p className="text-sm">{SUBMISSION_NOTICE}</p><p className="text-xs">Use Copy package, Download JSON, or Print / Save as PDF below. Exporting does not transmit the package to any target entity.</p>
  </section>;
}

