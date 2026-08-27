/**
 * Server-side guard.
 *
 * The `server-only` npm package throws when resolved outside a bundler, which
 * breaks the CLI entry points (migrate/seed/worker) that legitimately import
 * these modules in plain Node. This does the same job for both worlds: it fails
 * loudly if a module that touches the database, secrets, or credentials is ever
 * evaluated in a browser bundle.
 */
export function assertServerOnly(moduleName: string): void {
  if (typeof window !== 'undefined') {
    throw new Error(
      `[security] ${moduleName} is server-only and must never reach a client bundle.`,
    );
  }
}
