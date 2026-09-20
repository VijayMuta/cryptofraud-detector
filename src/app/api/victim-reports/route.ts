import { NextRequest } from 'next/server';
import { REPORT_FIELDS, validateReport } from '@/lib/victim-reports';
import { databaseFailure, reportBody, reportContext, reportFailure, reportResponse, ReportError } from '@/lib/victim-report-server';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const { user, admin } = await reportContext(request);
    const parsed = validateReport(await reportBody(request));
    if (!parsed.data) throw new ReportError(parsed.error!, 400);
    const { data, error } = await admin.from('victim_reports').insert({ ...parsed.data, user_id: user.id, status: 'submitted' }).select(REPORT_FIELDS).single();
    databaseFailure(error);
    if (!data) throw new ReportError('No saved report was returned. Submission is not confirmed.', 503);
    return reportResponse({ report: data }, 201);
  } catch (error) { return reportFailure(error); }
}
export async function GET(request: NextRequest) {
  try {
    const { user, admin } = await reportContext(request);
    if (request.nextUrl.searchParams.get('summary') === '1') {
      const statuses = ['submitted', 'under_review', 'investigating', 'closed'] as const;
      const results = await Promise.all(statuses.map(status => admin.from('victim_reports').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('status', status)));
      results.forEach(result => databaseFailure(result.error));
      if (results.some(result => typeof result.count !== 'number')) throw new ReportError('Report counts are unavailable. Please retry.', 503);
      return reportResponse({ counts: Object.fromEntries(statuses.map((status, index) => [status, results[index].count])) });
    }
    const page = Number(request.nextUrl.searchParams.get('page') || 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw new ReportError('Choose a valid report page.', 400);
    const { data, error, count } = await admin.from('victim_reports').select('id,suspect_wallet,network,incident_type,status,created_at', { count: 'exact' }).eq('user_id', user.id).order('created_at', { ascending: false }).order('id', { ascending: false }).range((page - 1) * 10, page * 10 - 1);
    databaseFailure(error);
    if (typeof count !== 'number') throw new ReportError('The report register count is unavailable. Please retry.', 503);
    return reportResponse({ reports: data || [], total: count, page });
  } catch (error) { return reportFailure(error); }
}
