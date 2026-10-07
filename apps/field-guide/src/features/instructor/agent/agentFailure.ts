import { AgentFailure } from '../../events/types';

export const CloseCode = {
  normal: 1000,
  policy: 1008,
  authFirst: 4001,
  authLast: 4003,
} as const;
const HttpStatus = { ok: 200, quota: 429, unavailable: 503 } as const;
const WorkerError = { quota: 'voice quota', auth: 'voice auth' } as const;

function agentFailure(code: number, reason: string): AgentFailure | null {
  if (/quota|limit/i.test(reason)) {
    return AgentFailure.quota;
  }
  if (
    code === CloseCode.policy ||
    (code >= CloseCode.authFirst && code <= CloseCode.authLast) ||
    /auth|unauthorized|forbidden/i.test(reason)
  ) {
    return AgentFailure.auth;
  }
  return null;
}
export function closeFailure(
  code: number,
  reason: string,
): AgentFailure | null {
  return (
    agentFailure(code, reason) ??
    (code === CloseCode.normal ? null : AgentFailure.network)
  );
}
export function clientFailure(
  code: number,
  name: string,
  message: string,
): AgentFailure {
  return agentFailure(code, `${name} ${message}`) ?? AgentFailure.unknown;
}
export function connectionFailure(error: unknown): AgentFailure {
  const reason = error instanceof Error ? error.message : AgentFailure.network;
  return reason === AgentFailure.quota
    ? AgentFailure.quota
    : reason === AgentFailure.auth
    ? AgentFailure.auth
    : AgentFailure.network;
}
export function sessionUrl(status: number, body: unknown): string {
  const fields =
    body !== null && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : {};
  if (
    status === HttpStatus.ok &&
    typeof fields.signedUrl === 'string' &&
    fields.signedUrl !== ''
  ) {
    return fields.signedUrl;
  }
  if (status === HttpStatus.quota && fields.error === WorkerError.quota) {
    throw new Error(AgentFailure.quota);
  }
  if (status === HttpStatus.unavailable || fields.error === WorkerError.auth) {
    throw new Error(AgentFailure.auth);
  }
  throw new Error(AgentFailure.network);
}
