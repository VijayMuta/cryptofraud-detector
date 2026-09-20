import { NextRequest, NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { isEthereumAddress } from '@/lib/ethereum-address';
import { aiConfigured, answerFromEvidence, AssistantError } from '@/lib/ai-provider';
import { authorizeCase, buildEvidence, type ContextTarget } from '@/lib/ai-evidence';
import { beginAssistantRequest, getSnapshot, saveSnapshot } from '@/lib/ai-session';
import { NOT_CONFIGURED } from '@/lib/ai-contract';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function GET(request: NextRequest) {
  if (!await getRequestUser(request)) return reply({ error: 'Sign in to use the assistant.' }, 401);
  return reply({ configured: aiConfigured() });
}
export async function POST(request: NextRequest) {
  const user = await getRequestUser(request);
  if (!user) return reply({ error: 'Sign in to use the assistant.' }, 401);
  let release: (() => void) | undefined;
  try {
    if (Number(request.headers.get('content-length')) > 8192) throw new AssistantError('Request is too large.', 413);
    const raw = await request.text();
    if (raw.length > 8192) throw new AssistantError('Request is too large.', 413);
    let body: Record<string, unknown>;
    try { body = JSON.parse(raw); } catch { throw new AssistantError('Invalid request.', 400); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AssistantError('Invalid request.', 400);
    release = beginAssistantRequest(user.id);
    if (body.action === 'load') {
      const kind = body.kind;
      const value = typeof body.value === 'string' ? body.value.trim() : '';
      if (kind !== 'wallet' && kind !== 'case') throw new AssistantError('Choose a wallet or case context.', 400);
      if (kind === 'wallet' && !isEthereumAddress(value)) throw new AssistantError('Enter a valid Ethereum wallet address.', 400);
      if (kind === 'case' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new AssistantError('Choose a valid case.', 400);
      const target: ContextTarget = { kind, value };
      const evidence = await buildEvidence(user.id, target);
      return reply({ snapshotId: saveSnapshot(user.id, target, evidence), evidence, configured: aiConfigured() });
    }
    if (body.action !== 'ask' || typeof body.question !== 'string' || !body.question.trim() || body.question.length > 2000 || typeof body.snapshotId !== 'string') throw new AssistantError('Provide a question of 1–2000 characters and load evidence first.', 400);
    const snapshot = getSnapshot(user.id, body.snapshotId);
    // Recheck ownership on every question, including after a case has been deleted.
    if (snapshot.target.kind === 'case') await authorizeCase(user.id, snapshot.target.value);
    if (!aiConfigured()) throw new AssistantError(NOT_CONFIGURED, 503);
    return reply({ answer: await answerFromEvidence(body.question.trim(), snapshot.evidence) });
  } catch (error) {
    // Never return/log provider bodies, URLs, database errors or credential-bearing exceptions.
    return reply({ error: error instanceof AssistantError ? error.message : 'Unable to prepare investigation evidence. Check the data services and retry.' }, error instanceof AssistantError ? error.status : 502);
  } finally { release?.(); }
}
