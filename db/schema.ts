import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const employeeUsers = sqliteTable(
  "employee_users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    displayName: text("display_name").notNull(),
    branch: text("branch").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    usernameNormalizedUnique: uniqueIndex("employee_users_username_normalized_idx").on(table.usernameNormalized),
  }),
);

export const employeeSessions = sqliteTable(
  "employee_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id").notNull().references(() => employeeUsers.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("employee_sessions_token_hash_idx").on(table.tokenHash),
  }),
);

export const adminSessions = sqliteTable(
  "admin_sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("admin_sessions_token_hash_idx").on(table.tokenHash),
  }),
);

export const employeeData = sqliteTable("employee_data", {
  userId: integer("user_id").primaryKey().references(() => employeeUsers.id),
  stateJson: text("state_json").notNull().default("{}"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
