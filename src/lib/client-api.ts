'use client';

import { getSupabaseBrowser } from '@/lib/supabase';

function errorMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'string') return payload || fallback;
  if (typeof payload === 'object' && payload !== null && typeof (payload as { error?: unknown }).error === 'string') {
    return (payload as { error: string }).error;
  }
  return fallback;
}

/**
 * Enforces the response contract for every browser call to an application API.
 * Reading a clone leaves the original response body available to the existing
 * caller, while preventing an HTML error document from reaching response.json().
 */
async function requireJsonApiResponse(response: Response) {
  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    const payload = contentType.includes('application/json')
      ? await response.clone().json().catch(() => null)
      : await response.clone().text();
    throw new Error(errorMessage(payload, `API request failed (HTTP ${response.status}).`));
  }

  if (!contentType.includes('application/json')) {
    const text = await response.clone().text();
    throw new Error(`API returned a non-JSON response: ${text.slice(0, 200)}`);
  }

  return response;
}

export async function authenticatedFetch(path: string, options: RequestInit = {}) {
  const { data } = await getSupabaseBrowser().auth.getSession();
  if (!data.session?.access_token) throw new Error('Your session has expired. Please sign in again.');

  const response = await fetch(path, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${data.session.access_token}`,
    },
    cache: 'no-store',
  });

  return requireJsonApiResponse(response);
}
