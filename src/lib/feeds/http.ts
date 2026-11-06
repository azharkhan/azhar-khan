export type Get = { fetch: typeof fetch; signal: AbortSignal };

const userAgent = "azharkhan.net/0.0.0 (https://azharkhan.net)";

function safeUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

export function httpError(status: number, url: string): Error {
  return new Error(`HTTP ${status} ${safeUrl(url)}`);
}

export async function getText(ctx: Get, url: string, init: RequestInit = {}): Promise<{ status: number; body: string }> {
  let response: Response;
  try {
    const requestInit = { ...init, signal: ctx.signal };
    const headers = new Headers(init.headers);
    if (!headers.has("User-Agent")) {
      headers.set("User-Agent", userAgent);
      requestInit.headers = headers;
    }
    response = await ctx.fetch(url, requestInit);
  } catch {
    throw new Error(`request failed for ${safeUrl(url)}`);
  }
  return { status: response.status, body: await response.text() };
}

export async function getJson(ctx: Get, url: string, init?: RequestInit): Promise<unknown> {
  const response = await getText(ctx, url, init);
  if (response.status < 200 || response.status >= 300) throw httpError(response.status, url);
  try {
    return JSON.parse(response.body) as unknown;
  } catch {
    throw new Error(`invalid JSON from ${safeUrl(url)}`);
  }
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}
