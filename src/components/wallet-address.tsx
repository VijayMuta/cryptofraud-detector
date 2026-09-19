'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';

export function WalletAddress({ address }: { address: string }) {
  const [status, setStatus] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    clearTimeout(timer.current);
    try { await navigator.clipboard.writeText(address); setStatus('Address copied'); }
    catch { setStatus('Copy unavailable. Select the address in the explorer.'); }
    timer.current = setTimeout(() => setStatus(''), 2500);
  }
  return <span className="inline-flex max-w-full flex-wrap items-center gap-1.5 align-middle">
    <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noreferrer" title={address} className="inline-flex items-center gap-1.5 font-mono text-xs text-cyan-200 hover:text-cyan-100"><span>{address.length > 20 ? `${address.slice(0, 8)}…${address.slice(-6)}` : address}</span><ExternalLink size={12} aria-label="Open in Etherscan" /></a>
    <button type="button" onClick={() => void copy()} aria-label={`Copy wallet address ${address}`} title="Copy full address" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-cyan-200">{status === 'Address copied' ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}</button>
    <span role="status" className={status ? 'basis-full text-xs text-slate-300' : 'sr-only'}>{status}</span>
  </span>;
}
