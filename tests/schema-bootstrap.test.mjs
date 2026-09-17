import assert from "node:assert/strict";
import test from "node:test";
import { ensureDatabaseSchema, schemaStatementCount } from "../db/ensure-schema.mjs";

test("a fresh D1 binding receives the complete idempotent schema once", async () => {
  const prepared = [];
  let batches = 0;
  const database = {
    prepare(statement) {
      prepared.push(statement);
      return { statement };
    },
    async batch(statements) {
      batches += 1;
      assert.equal(statements.length, schemaStatementCount);
      return [];
    },
  };

  await Promise.all([ensureDatabaseSchema(database), ensureDatabaseSchema(database)]);
  assert.equal(batches, 1);
  assert.equal(prepared.length, schemaStatementCount);
  assert.ok(prepared.every((statement) => /IF NOT EXISTS/i.test(statement)));
  assert.ok(prepared.some((statement) => /employee_users/i.test(statement)));
  assert.ok(prepared.some((statement) => /employee_sessions/i.test(statement)));
  assert.ok(prepared.some((statement) => /employee_data/i.test(statement)));
  assert.ok(prepared.some((statement) => /admin_sessions/i.test(statement)));
});

test("schema initialization can recover after a transient D1 failure", async () => {
  let attempts = 0;
  const database = {
    prepare(statement) {
      return { statement };
    },
    async batch() {
      attempts += 1;
      if (attempts === 1) throw new Error("transient");
      return [];
    },
  };

  await assert.rejects(ensureDatabaseSchema(database), /transient/);
  await ensureDatabaseSchema(database);
  assert.equal(attempts, 2);
});
