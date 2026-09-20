import { NextRequest } from 'next/server';
import { REPORT_FIELDS, REPORT_ID, REPORT_STATUSES } from '@/lib/victim-reports';
import { databaseFailure, reportBody, reportContext, reportFailure, reportResponse, ReportError } from '@/lib/victim-report-server';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, admin } = await reportContext(request);
    if (!REPORT_ID.test(params.id)) throw new ReportError('Report not found.', 404);
    const { data, error } = await admin.from('victim_reports').select(REPORT_FIELDS).eq('id', params.id).eq('user_id', user.id).maybeSingle();
    databaseFailure(error);
    if (!data) throw new ReportError('Report not found.', 404);
    const duplicate = await admin.from('victim_reports').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('network', data.network).eq('suspect_wallet', data.suspect_wallet);
    // A count failure must not conceal an otherwise readable report or fabricate zero.
    return reportResponse({ report: data, sameWalletCount: duplicate.error ? null : duplicate.count });
  } catch (error) { return reportFailure(error); }
}
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { user, admin } = await reportContext(request);
    if (!REPORT_ID.test(params.id)) throw new ReportError('Report not found.', 404);
    const body = await reportBody(request);
    if (!(REPORT_STATUSES as readonly unknown[]).includes(body.status)) throw new ReportError('Choose a valid report status.', 400);
    // Existing Cases pattern: an authenticated owner can manage their own workflow status.
    const { data, error } = await admin.from('victim_reports').update({ status: body.status }).eq('id', params.id).eq('user_id', user.id).select(REPORT_FIELDS).maybeSingle();
    databaseFailure(error);
    if (!data) throw new ReportError('Report not found.', 404);
    return reportResponse({ report: data });
  } catch (error) { return reportFailure(error); }
}
