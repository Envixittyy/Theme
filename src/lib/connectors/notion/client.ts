import { assertServerOnly } from '../../server-guard';
import { redactError } from '../../security/redact';

assertServerOnly('lib/connectors/notion/client');

/**
 * Minimal Notion API client.
 *
 * Only the six calls this product needs, behind an interface so the sync engine
 * can be tested without the network and so a future API version is a change in
 * one file. Tokens are passed in per call and never cached at module scope.
 */

const NOTION_VERSION = '2022-06-28';
const API_BASE = 'https://api.notion.com/v1';

export type NotionPropertyValue = Record<string, unknown>;

export type NotionPage = {
  id: string;
  url: string;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  properties: Record<string, NotionPropertyValue>;
};

export type NotionDatabase = {
  id: string;
  title: Array<{ plain_text: string }>;
  properties: Record<string, { id: string; name: string; type: string; [k: string]: unknown }>;
};

export type QueryResult = { pages: NotionPage[]; nextCursor: string | null };

export class NotionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'NotionApiError';
  }
  /** Notion asks callers to back off on these; anything else is a real fault. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

export interface NotionClient {
  listDatabases(): Promise<Array<{ id: string; title: string }>>;
  getDatabase(databaseId: string): Promise<NotionDatabase>;
  queryDatabase(databaseId: string, options?: { since?: Date; cursor?: string; pageSize?: number }): Promise<QueryResult>;
  getPage(pageId: string): Promise<NotionPage>;
  createPage(databaseId: string, properties: Record<string, NotionPropertyValue>): Promise<NotionPage>;
  updatePage(pageId: string, properties: Record<string, NotionPropertyValue>): Promise<NotionPage>;
  archivePage(pageId: string): Promise<NotionPage>;
}

export class HttpNotionClient implements NotionClient {
  constructor(private readonly token: string) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.token}`,
        'Notion-Version': NOTION_VERSION,
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!response.ok) {
      let code = 'unknown';
      let message = `Notion responded ${response.status}`;
      try {
        const payload = (await response.json()) as { code?: string; message?: string };
        code = payload.code ?? code;
        // The token can appear in Notion's own error echoes; scrub before it
        // reaches a sync record or a log line.
        message = redactError(payload.message ?? message, [this.token]);
      } catch {
        /* keep the default */
      }
      throw new NotionApiError(response.status, code, message);
    }
    return (await response.json()) as T;
  }

  async listDatabases(): Promise<Array<{ id: string; title: string }>> {
    const result = await this.call<{ results: Array<{ id: string; title?: Array<{ plain_text: string }> }> }>(
      '/search',
      {
        method: 'POST',
        body: JSON.stringify({ filter: { property: 'object', value: 'data_source' }, page_size: 50 }),
      },
    ).catch(async (err) => {
      // Older integrations expose databases rather than data sources.
      if (err instanceof NotionApiError && err.status === 400) {
        return this.call<{ results: Array<{ id: string; title?: Array<{ plain_text: string }> }> }>('/search', {
          method: 'POST',
          body: JSON.stringify({ filter: { property: 'object', value: 'database' }, page_size: 50 }),
        });
      }
      throw err;
    });

    return result.results.map((r) => ({
      id: r.id,
      title: r.title?.map((t) => t.plain_text).join('') || 'Untitled database',
    }));
  }

  getDatabase(databaseId: string): Promise<NotionDatabase> {
    return this.call<NotionDatabase>(`/databases/${databaseId}`);
  }

  async queryDatabase(
    databaseId: string,
    options: { since?: Date; cursor?: string; pageSize?: number } = {},
  ): Promise<QueryResult> {
    const body: Record<string, unknown> = {
      page_size: options.pageSize ?? 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'ascending' }],
    };
    if (options.cursor) body.start_cursor = options.cursor;
    if (options.since) {
      // Incremental pull: only pages touched since the last successful run.
      body.filter = { timestamp: 'last_edited_time', last_edited_time: { on_or_after: options.since.toISOString() } };
    }
    const result = await this.call<{ results: NotionPage[]; next_cursor: string | null }>(
      `/databases/${databaseId}/query`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { pages: result.results, nextCursor: result.next_cursor };
  }

  getPage(pageId: string): Promise<NotionPage> {
    return this.call<NotionPage>(`/pages/${pageId}`);
  }

  createPage(databaseId: string, properties: Record<string, NotionPropertyValue>): Promise<NotionPage> {
    return this.call<NotionPage>('/pages', {
      method: 'POST',
      body: JSON.stringify({ parent: { database_id: databaseId }, properties }),
    });
  }

  updatePage(pageId: string, properties: Record<string, NotionPropertyValue>): Promise<NotionPage> {
    return this.call<NotionPage>(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ properties }) });
  }

  archivePage(pageId: string): Promise<NotionPage> {
    return this.call<NotionPage>(`/pages/${pageId}`, { method: 'PATCH', body: JSON.stringify({ archived: true }) });
  }
}

/* ------------------------------ OAuth helper ------------------------------ */

export function notionAuthorizeUrl(state: string): string | null {
  const clientId = process.env.NOTION_CLIENT_ID;
  const redirectUri = process.env.NOTION_REDIRECT_URI;
  if (!clientId || !redirectUri) return null;
  const url = new URL('https://api.notion.com/v1/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('owner', 'user');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

export async function exchangeNotionCode(code: string): Promise<{
  accessToken: string;
  workspaceId: string;
  workspaceName: string;
}> {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  const redirectUri = process.env.NOTION_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Notion OAuth is not configured on this server');
  }

  const response = await fetch(`${API_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'content-type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });

  if (!response.ok) {
    throw new Error(`Notion rejected the authorization code (${response.status})`);
  }
  const payload = (await response.json()) as {
    access_token: string;
    workspace_id: string;
    workspace_name?: string;
  };
  return {
    accessToken: payload.access_token,
    workspaceId: payload.workspace_id,
    workspaceName: payload.workspace_name ?? 'Notion workspace',
  };
}
