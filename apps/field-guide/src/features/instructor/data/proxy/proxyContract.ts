/** The instructor Worker's routes, as `services/instructor-proxy` serves them. */
export const ProxyPath = {
  answer: '/v1/answer',
  voiceSession: '/v1/voice/session',
  ping: '/v1/ping',
} as const;

/** The Worker statuses the app tells apart. */
export const ProxyStatus = {
  ok: 200,
  noContent: 204,
  rateLimited: 429,
  unavailable: 503,
} as const;

/** The Worker's error strings for a refused voice session. */
export const ProxyError = {
  voiceQuota: 'voice quota',
  voiceAuth: 'voice auth',
} as const;

/** The answer request body is JSON; the reply streams one JSON object per line. */
export const JSON_CONTENT_TYPE = 'application/json';
export const CONTENT_TYPE_HEADER = 'Content-Type';
