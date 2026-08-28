// Thin fetch wrapper over the Swop public APIs. The MCP server holds no
// credentials in Phase 1 — every upstream call is unauthenticated public data.

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'user-agent': 'swop-mcp/0.1',
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) {
    const msg =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error: unknown }).error)
          : text.slice(0, 300);
    throw new UpstreamError(res.status, msg);
  }
  return body;
}

export function getJson(base: string, path: string, params?: Record<string, string | number | undefined>): Promise<unknown> {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  return request(url.toString());
}

export function postJson(base: string, path: string, body: unknown): Promise<unknown> {
  return request(new URL(path, base).toString(), {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
