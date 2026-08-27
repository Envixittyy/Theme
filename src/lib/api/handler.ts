import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { assertCsrf, CsrfError } from '../auth/csrf';
import { requireUser, UnauthorizedError, type AuthenticatedUser } from '../auth/session';
import { NotFoundError } from '../domain/tasks';
import { UnsafeUrlError } from '../security/ssrf';
import { redactError } from '../security/redact';
import { rateLimit } from '../security/ratelimit';

/**
 * Route-handler wrapper.
 *
 * Every handler gets the same treatment: authenticate, enforce CSRF on
 * state-changing verbs, rate-limit, validate, and map errors onto status codes
 * without ever leaking an internal message. Handlers themselves stay small —
 * they validate, authorize, do or enqueue work, and return.
 */

export type Handler<T> = (args: {
  request: NextRequest;
  user: AuthenticatedUser;
  params: Record<string, string>;
}) => Promise<T>;

export type RouteOptions = {
  /** Requests per window, per user. */
  limit?: number;
  windowMs?: number;
  /** Skip CSRF for GET/HEAD (default) or force it on. */
  requireCsrf?: boolean;
};

export function withUser<T>(handler: Handler<T>, options: RouteOptions = {}) {
  return async (
    request: NextRequest,
    context: { params: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      const user = await requireUser();
      const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      if (options.requireCsrf ?? mutating) await assertCsrf();

      const limit = options.limit ?? (mutating ? 240 : 600);
      const gate = await rateLimit(`api:${request.method}:${new URL(request.url).pathname}`, user.id, limit, options.windowMs ?? 60_000);
      if (!gate.allowed) {
        return NextResponse.json(
          { error: 'Too many requests. Try again shortly.' },
          { status: 429, headers: { 'retry-after': String(Math.ceil((gate.resetAt.getTime() - Date.now()) / 1000)) } },
        );
      }

      const params = await context.params;
      const result = await handler({ request, user, params: params ?? {} });
      if (result === undefined || result === null) return new NextResponse(null, { status: 204 });
      return NextResponse.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError) {
    return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  }
  if (err instanceof CsrfError) {
    return NextResponse.json({ error: 'Your session expired. Reload and try again.' }, { status: 403 });
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      {
        error: err.issues[0]?.message ?? 'That input is not valid.',
        fields: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
      { status: 422 },
    );
  }
  if (err instanceof UnsafeUrlError) {
    // The reason is safe by construction (the URL is already redacted inside).
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  // Anything else: redact and log server-side, return something generic.
  const message = redactError(err);
  console.error('[api]', message);
  return NextResponse.json({ error: 'Something went wrong. The problem was logged.' }, { status: 500 });
}

export async function readJson<T>(request: NextRequest): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ZodError([
      { code: 'custom', path: [], message: 'Expected a JSON body.', input: undefined },
    ]);
  }
}
