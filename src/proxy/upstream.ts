const hopByHop = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
]);

export function joinUpstreamUrl(base: string, pathAndQuery: string): string {
  const b = base.replace(/\/$/, "");
  let pq = pathAndQuery;
  if (!pq.startsWith("/")) pq = `/${pq}`;
  return `${b}${pq}`;
}

export function buildUpstreamHeaders(incoming: Headers, upstreamBearer: string): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (hopByHop.has(lower) || lower === "authorization") return;
    out.set(key, value);
  });
  out.set("authorization", `Bearer ${upstreamBearer}`);
  return out;
}

export async function proxyToUpstream(input: {
  upstreamUrl: string;
  method: string;
  headers: Headers;
  body: BodyInit | null | undefined;
  timeoutMs: number;
}): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    return await fetch(input.upstreamUrl, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      redirect: "manual",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

export function filterResponseHeaders(upstream: Response): Headers {
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (hopByHop.has(lower)) return;
    out.set(key, value);
  });
  return out;
}
