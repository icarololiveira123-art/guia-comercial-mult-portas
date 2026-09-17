const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS employee_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    username TEXT NOT NULL,
    username_normalized TEXT NOT NULL,
    display_name TEXT NOT NULL,
    branch TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS employee_users_username_normalized_idx ON employee_users (username_normalized)",
  `CREATE TABLE IF NOT EXISTS employee_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES employee_users(id) ON UPDATE NO ACTION ON DELETE NO ACTION
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS employee_sessions_token_hash_idx ON employee_sessions (token_hash)",
  `CREATE TABLE IF NOT EXISTS employee_data (
    user_id INTEGER PRIMARY KEY NOT NULL,
    state_json TEXT DEFAULT '{}' NOT NULL,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    FOREIGN KEY (user_id) REFERENCES employee_users(id) ON UPDATE NO ACTION ON DELETE NO ACTION
  )`,
  `CREATE TABLE IF NOT EXISTS admin_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS admin_sessions_token_hash_idx ON admin_sessions (token_hash)",
];

const initializationByDatabase = new WeakMap();

/**
 * Makes a fresh D1 binding self-healing while keeping Drizzle migrations as the
 * canonical schema history. Every statement is idempotent and sent separately.
 * @param {{ prepare(sql: string): unknown, batch(statements: unknown[]): Promise<unknown> }} database
 */
export async function ensureDatabaseSchema(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.batch !== "function") {
    throw new TypeError("O binding D1 não está disponível para preparar o armazenamento.");
  }

  let pending = initializationByDatabase.get(database);
  if (!pending) {
    pending = database.batch(SCHEMA_STATEMENTS.map((statement) => database.prepare(statement))).catch((error) => {
      initializationByDatabase.delete(database);
      throw error;
    });
    initializationByDatabase.set(database, pending);
  }
  await pending;
}

export const schemaStatementCount = SCHEMA_STATEMENTS.length;
