import { errorStatus } from './github.js';

const HARD_QUOTA = new Set(['insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded', 'organization_usage_limit_exceeded', 'billing_hard_limit_reached']);
const SAFE_CODES = new Set([...HARD_QUOTA, 'rate_limit_exceeded', 'rate_limit_error', 'slow_down',
  'server_is_overloaded', 'RESOURCE_EXHAUSTED', 'NOT_FOUND', 'PERMISSION_DENIED', 'UNAUTHENTICATED',
  'INVALID_ARGUMENT', 'UNAVAILABLE', 'INTERNAL', 'model_not_found', 'model_not_available']);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const string = (value: unknown): string => typeof value === 'string' ? value : '';

function duration(value: unknown): number | undefined {
  if (typeof value === 'string' && /^\d+(?:\.\d+)?s$/.test(value)) return Number(value.slice(0, -1)) * 1000;
  const data = object(value);
  if (data.seconds !== undefined || data.nanos !== undefined) {
    const ms = Number(data.seconds ?? 0) * 1000 + Number(data.nanos ?? 0) / 1e6;
    if (Number.isFinite(ms) && ms >= 0) return ms;
  }
  return undefined;
}

export interface FailureInfo {
  httpStatus?: number;
  providerCode?: string;
  reason: string;
  retryable: boolean;
  retryAfterMs?: number;
  guidance: string;
}

/** Raw error text is inspected only for fixed classifications, never returned. */
export function classifyFailure(error: unknown, now = Date.now()): FailureInfo {
  const root = object(error);
  let body = object(root.error);
  if (!Object.keys(body).length && typeof root.body === 'string' && root.body.length <= 100_000) {
    try { body = object(JSON.parse(root.body)); } catch { /* No raw body output. */ }
  }
  if (body.error) body = object(body.error);
  const status = errorStatus(error);
  const codes = [root.code, root.type, body.code, body.type, body.status].filter((v): v is string => typeof v === 'string');
  const providerCode = codes.find(code => SAFE_CODES.has(code));
  const details = Array.isArray(body.details) ? body.details.map(object) : [];
  const violations = details.filter(d => string(d['@type']).endsWith('/google.rpc.QuotaFailure'))
    .flatMap(d => Array.isArray(d.violations) ? d.violations.map(object) : []);
  const quotas = violations.map(v => `${string(v.quotaId)} ${string(v.quotaMetric)}`);
  const hardQuota = codes.some(code => HARD_QUOTA.has(code))
    || quotas.some(q => /per[_-]?day|daily|per[_-]?month/i.test(q))
    || violations.some(v => v.quotaValue === 0 || v.quotaValue === '0');
  const headers = root.headers;
  const header = (name: string): string => headers instanceof Headers ? headers.get(name) ?? ''
    : string(Object.entries(object(headers)).find(([key]) => key.toLowerCase() === name)?.[1]);
  const delays: number[] = [];
  const msHeader = header('retry-after-ms');
  const secondsHeader = header('retry-after');
  if (/^\d+(?:\.\d+)?$/.test(msHeader)) delays.push(Number(msHeader));
  if (/^\d+(?:\.\d+)?$/.test(secondsHeader)) delays.push(Number(secondsHeader) * 1000);
  else if (secondsHeader && Number.isFinite(Date.parse(secondsHeader))) delays.push(Math.max(0, Date.parse(secondsHeader) - now));
  for (const detail of details) {
    if (!string(detail['@type']).endsWith('/google.rpc.RetryInfo')) continue;
    const ms = duration(detail.retryDelay);
    if (ms !== undefined) delays.push(ms);
  }
  const finiteDelays = delays.filter(n => Number.isFinite(n) && n >= 0);
  const retryAfterMs = finiteDelays.length ? Math.ceil(Math.max(...finiteDelays)) : undefined;
  const info = (reason: string, retryable: boolean, guidance: string): FailureInfo => ({
    ...(status === undefined ? {} : { httpStatus: status }), ...(providerCode ? { providerCode } : {}),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }), reason, retryable, guidance,
  });
  if (hardQuota || status === 402) return info('quota-exhausted', false, 'AI provider quota or credits exhausted. Check billing and daily/monthly limits before retrying.');
  if (status === 429) {
    const temporary = retryAfterMs !== undefined || codes.some(c => ['rate_limit_exceeded', 'rate_limit_error', 'slow_down'].includes(c))
      || quotas.some(q => /per[_-]?minute|per[_-]?second/i.test(q));
    return info(temporary ? 'rate-limited' : 'quota-or-rate-limit', temporary,
      'AI provider quota or rate limit reached. Check account quotas; ambiguous limits are not automatically retried.');
  }
  if (status === 401 || status === 403) return info('access-denied', false, 'AI provider authentication/access failed. Check the selected provider, key, account region, and model access.');
  if (status === 404 || status === 400 || status === 422) {
    const message = `${string(body.message)} ${string(root.message)}`.slice(0, 20_000);
    if (/retired|deprecated|discontinued|no longer available/i.test(message)) return info('model-retired', false, 'The model appears retired or deprecated. Select an available supported model explicitly.');
    if (/new (?:users|projects|accounts)|not available.*(?:account|project)|access.*model/i.test(message)) return info('model-access-restricted', false, 'Model access appears restricted for this account/project. A model-list entry does not guarantee access.');
    return info('request-rejected', false, 'AI provider rejected the request. Check model availability, retirement/access restrictions, API version, and structured-output support.');
  }
  if (status !== undefined && status >= 500 && status < 600) return info('provider-unavailable', true, 'AI provider is temporarily unavailable. Review unavailable; retry later.');
  if (status === 408) return info('timeout', true, 'AI provider request timed out. Timed-out requests may still consume quota.');
  const name = error instanceof Error ? error.name : '';
  if (['AbortError', 'TimeoutError', 'APIConnectionTimeoutError', 'RequestTimeoutError'].includes(name)) return info('timeout', true, 'AI provider request timed out. Timed-out requests may still consume quota.');
  return info('connection-failed', status === undefined && ['APIConnectionError', 'ConnectionError', 'TypeError'].includes(name), 'AI provider request failed. Review unavailable.');
}
