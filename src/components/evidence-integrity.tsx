'use client';

import { useEffect, useState } from 'react';
import { canonicalSerialize, createIntegrityRecord, verifyEvidence, INTEGRITY_NOTICE, INTEGRITY_SCOPE, type EvidencePayload, type IntegrityRecord, type VerificationResult } from '@/lib/evidence-integrity';
import { downloadFile } from '@/lib/download';

/** Results are bound to canonical content, so changes invalidate them immediately. */
export function useEvidenceIntegrity(payload: EvidencePayload | null, reference: { caseId?: string; caseCode?: string }) {
  let canonical: string | null = null;
  let serializationError = '';
  try { canonical = payload ? canonicalSerialize(payload) : null; }
  catch { serializationError = 'Evidence contains unsupported data and cannot be hashed without changing it.'; }
  const [state, setState] = useState<{ canonical: string; record?: IntegrityRecord; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { caseId, caseCode } = reference;
  useEffect(() => {
    if (!canonical) return;
    let active = true;
    setState(null);
    createIntegrityRecord(JSON.parse(canonical), { ...(caseId ? { caseId } : {}), ...(caseCode ? { caseCode } : {}) }).then(record => {
      if (active) setState({ canonical, record });
    }).catch(() => { if (active) setState({ canonical, error: 'SHA-256 hashing failed. Platform cryptography may be unavailable; retry in a secure browser context.' }); });
    return () => { active = false; };
  }, [canonical, caseId, caseCode, attempt]);
  return {
    canonical,
    record: state?.canonical === canonical ? state?.record : undefined,
    error: serializationError || (state?.canonical === canonical ? state?.error : '') || '',
    retry: () => setAttempt(value => value + 1),
  };
}

const button = 'rounded-xl border border-cyan-400/25 px-4 py-2.5 text-sm text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-40';
export function EvidenceIntegrity({ payload, integrity }: { payload: EvidencePayload | null; integrity: ReturnType<typeof useEvidenceIntegrity> }) {
  const [expected, setExpected] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ canonical: string | null; expected: string; result: VerificationResult } | null>(null);
  const [message, setMessage] = useState('');
  const record = integrity.record;
  const currentResult = result?.canonical === integrity.canonical && result?.expected === expected ? result.result : null;
  async function verify() {
    setChecking(true); setResult(null);
    const result = await verifyEvidence(payload, expected);
    setResult({ canonical: integrity.canonical, expected, result }); setChecking(false);
  }
  return <section className="panel space-y-4 p-5" aria-label="Evidence Integrity">
    <h2 className="text-lg font-semibold text-white">Evidence Integrity · SHA-256</h2>
    <p className="text-xs leading-6 text-slate-400">{INTEGRITY_NOTICE}</p>
    <p className="text-xs text-slate-400">Hashing happens locally. Save the fingerprint separately for later comparison; an editable hash record alone does not prove who collected the evidence.</p>
    {record ? <dl className="space-y-2 text-xs"><dt>Evidence SHA-256</dt><dd className="break-all font-mono text-cyan-200">{record.hash}</dd><dt>Integrity generated (UTC)</dt><dd>{record.generatedAt}</dd><dt>Case reference</dt><dd>{record.caseCode || 'Unavailable'} · {record.caseId || 'Unavailable'}</dd><dt>Package / version</dt><dd>{record.packageType} · {record.packageVersion}</dd></dl> : <p role="status" className="text-sm">{integrity.error || (!payload ? 'Current evidence unavailable. Load a case or evidence package.' : 'Computing SHA-256…')}</p>}
    {integrity.error && <button className={button} onClick={integrity.retry}>Retry hashing</button>}
    <details className="text-xs leading-6 text-slate-400"><summary className="cursor-pointer text-cyan-200">What is hashed?</summary><p>{INTEGRITY_SCOPE}</p><p>UI controls and visual formatting are outside the payload. Substantive updates, including new retrieval timestamps or audit entries, can legitimately change the fingerprint.</p></details>
    <div className="flex flex-wrap gap-3 print:hidden"><button className={button} disabled={!record} onClick={async () => { try { await navigator.clipboard.writeText(record!.hash); setMessage('Hash copied.'); } catch { setMessage('Copy unavailable. Select the full hash above to copy it.'); } }}>Copy Hash</button><button className={button} disabled={!record} onClick={() => { try { downloadFile('chaintrace-integrity.json', JSON.stringify(record, null, 2) + '\n', 'application/json'); setMessage('Integrity record download initiated.'); } catch { setMessage('Download unavailable. Try again.'); } }}>Download Integrity Record</button></div>
    <p role="status" className="text-xs">{message}</p>
    <div className="space-y-3 print:hidden"><label className="block text-sm">Previously generated SHA-256 hash<input className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-white" value={expected} onChange={event => setExpected(event.target.value)} placeholder="64 hexadecimal characters" spellCheck={false} /></label><button className={button} disabled={checking} onClick={() => void verify()}>{checking ? 'Verifying…' : 'Verify Integrity'}</button>
      {currentResult && <div role="status" className={`rounded-xl border p-4 text-sm ${currentResult.status === 'MATCH' ? 'border-emerald-400/30 text-emerald-200' : 'border-amber-400/30 text-amber-200'}`}><strong>{currentResult.status.replace('_', ' ')}</strong><p className="mt-2">{currentResult.message}</p>{currentResult.status === 'MISMATCH' && <p className="mt-2">Changes may be legitimate; a mismatch does not establish malicious tampering.</p>}</div>}
    </div>
  </section>;
}
