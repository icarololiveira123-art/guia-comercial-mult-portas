import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { verifyBracesProtection } from "../scripts/patch-braces.mjs";
import { actionableFindings, GUARDED_ADVISORY } from "../scripts/audit-dependencies.mjs";

const require = createRequire(import.meta.url);
const braces = require("braces");

test("the braces guard is verified and keeps ordinary build glob patterns compatible", async () => {
  assert.ok((await verifyBracesProtection()).length > 0);
  assert.deepEqual(braces.expand("app/{page,layout}.{ts,tsx}"), ["app/page.ts", "app/page.tsx", "app/layout.ts", "app/layout.tsx"]);
  assert.deepEqual(braces.expand("item-{1..3}"), ["item-1", "item-2", "item-3"]);
  assert.equal(braces.stringify(braces.parse("a/{b,{c,d}}/e")), "a/{b,{c,d}}/e");
});

test("crafted deep patterns and ASTs are rejected before recursive processing", () => {
  const pattern = "{".repeat(2000) + "x" + "}".repeat(2000);
  for (const method of [braces, braces.parse, braces.compile, braces.expand, braces.stringify, braces.create]) {
    assert.throws(() => method(pattern), /safe nesting limit/);
  }
  let ast = { type: "text", value: "x" };
  for (let index = 0; index < 2000; index++) ast = { type: "brace", nodes: [ast] };
  for (const method of [braces.compile, braces.expand, braces.stringify]) assert.throws(() => method(ast), /safe nesting limit/);
  const cyclic = { nodes: [] };
  cyclic.nodes.push(cyclic);
  assert.throws(() => braces.stringify(cyclic), /safe nesting limit/);
});

test("audit mitigation is restricted to one advisory and never hides other high or critical findings", () => {
  const known = { name: "braces", severity: "high", url: GUARDED_ADVISORY };
  const vulnerabilities = {
    braces: { severity: "high", via: [known] },
    micromatch: { severity: "high", via: ["braces"] },
    unrelated: { severity: "high", via: [{ name: "unrelated", severity: "high", url: "https://example.invalid/new" }] },
    critical: { severity: "critical", via: [{ ...known, severity: "critical" }] },
  };
  assert.deepEqual(actionableFindings({ vulnerabilities }), ["unrelated", "critical"]);
  vulnerabilities.braces.via.push({ ...known, url: "https://example.invalid/new-braces-advisory" });
  assert.deepEqual(actionableFindings({ vulnerabilities }), ["braces", "micromatch", "unrelated", "critical"]);
});
