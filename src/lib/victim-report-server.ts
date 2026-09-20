import { NextResponse } from 'next/server';
import { getRequestUser } from '@/lib/request-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export class ReportError extends Error { constructor(message: string, readonly status: number) { super(message); } }
export const reportResponse = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function reportContext(request: Request) {
  const user = await getRequestUser(request);
  if (!user) throw new ReportError('Sign in to access private victim reports.', 401);
  try { return { user, admin: getSupabaseAdmin() }; }
  catch { throw new ReportError('Report storage is not configured on this server.', 503); }
}
export async function reportBody(request: Request) {
  if (Number(request.headers.get('content-length')) > 32000) throw new ReportError('Report request is too large.', 413);
  const text = await request.text();
  if (text.length > 16000) throw new ReportError('Report request is too large.', 413);
  try { const body = JSON.parse(text); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body as Record<string, unknown>; }
  catch { throw new ReportError('Enter valid report details.', 400); }
}
export function databaseFailure(error: { code?: string } | null) {
  if (!error) return;
  if (['42P01', 'PGRST205', '42703', 'PGRST204'].includes(error.code || '')) throw new ReportError('Victim report storage is unavailable. An administrator must apply supabase-victim-reports.sql in Supabase before reports can be saved.', 503);
  throw new ReportError('Unable to access report storage. Please retry. No submission has been confirmed.', 503);
}
export function reportFailure(error: unknown) {
  return reportResponse({ error: error instanceof ReportError ? error.message : 'Unable to process this report. Please retry.' }, error instanceof ReportError ? error.status : 500);
}
