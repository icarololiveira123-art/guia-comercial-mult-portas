interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<T[]>;
  exec(query: string): Promise<unknown>;
}

declare module "cloudflare:workers" {
  export const env: Record<string, unknown> & {
    DB?: D1Database;
    ADMIN_PASSWORD?: string;
    ADMIN_USERNAME?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
  };
}
