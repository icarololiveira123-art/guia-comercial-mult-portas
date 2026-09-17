import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("password hashing stays inside the hosted Worker PBKDF2 limit", async () => {
  const source = await readFile(new URL("../app/api/auth/_lib.ts", import.meta.url), "utf8");
  assert.match(source, /LEGACY_PASSWORD_HASH_ITERATIONS\s*=\s*100_000/);
  assert.match(source, /PASSWORD_HASH_ITERATIONS\s*=\s*100_000/);
  assert.match(source, /PASSWORD_HASH_ALGORITHM\s*=\s*"pbkdf2-sha256"/);
  assert.doesNotMatch(source, /from "node:crypto"/);
  assert.match(source, /crypto\.subtle\.deriveBits/);
  assert.match(source, /iterations !== PASSWORD_HASH_ITERATIONS/);
  assert.match(source, /passwordNeedsRehash/);
  assert.match(source, /passwordRequiresReset/);
  assert.match(source, /encoded:/);
  assert.match(source, /constantTimeEqual\(actualHash, expectedHash\)/);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("test-password"),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("test-salt"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  assert.equal(new Uint8Array(derived).byteLength, 32);
  assert.equal(
    Buffer.from(derived).toString("hex"),
    "19a34c2519ba5f998e80b7f159212b9cd08f999366eddda0aa7739e1f278c3d1",
  );
});

test("employee login upgrades old password records after a valid login", async () => {
  const source = await readFile(new URL("../app/api/auth/login/route.ts", import.meta.url), "utf8");
  assert.match(source, /passwordRequiresReset\(user\.passwordHash\)/);
  assert.match(source, /const session = await createSession\(request, user\.id\);[\s\S]*passwordNeedsRehash\(user\.passwordHash\)/);
  assert.match(source, /passwordHash: upgraded\.encoded/);
  assert.match(source, /auth_password_rehash_failed/);
});
