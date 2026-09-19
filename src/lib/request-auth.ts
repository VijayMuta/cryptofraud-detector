import { createClient } from '@supabase/supabase-js';

export async function getRequestUser(request: Request) {
  try {
    const authorization = request.headers.get('authorization');
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!token || !url || !anonKey) return null;

    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.getUser(token);

    return error ? null : data.user;
  } catch {
    // Every route treats an unavailable or invalid authentication lookup as an
    // unauthenticated request and returns its own JSON 401 response.
    return null;
  }
}
