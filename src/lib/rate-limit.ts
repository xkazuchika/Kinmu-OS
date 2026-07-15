type Attempt = { count: number; resetAt: number };
const attempts = new Map<string, Attempt>();

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super("試行回数が多すぎます。しばらく待ってから再度お試しください。");
    this.name = "RateLimitError";
  }
}

export function checkRateLimit(key: string, options = { limit: 10, windowMs: 60_000 }) {
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + options.windowMs });
    return;
  }
  if (current.count >= options.limit) {
    throw new RateLimitError(Math.ceil((current.resetAt - now) / 1_000));
  }
  current.count += 1;
}

export function rateLimitKey(request: Request, scope: string) {
  return `${scope}:${request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}`;
}
