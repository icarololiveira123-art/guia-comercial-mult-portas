import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createVault } from '../desktop/vault.mjs';
await app.whenReady();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-vault-test-'));
try {
  assert.equal(process.platform, 'win32');
  assert.equal(safeStorage.isEncryptionAvailable(), true);
  const file = path.join(directory, 'workspace.secure'); const vault = createVault(file, safeStorage);
  const data = { version: 1, accounts: {}, authRaw: randomUUID() }; vault.write(data);
  assert.ok(!fs.readFileSync(file).includes(Buffer.from(data.authRaw)));
  assert.deepEqual(vault.read(), data);
  const changed = { ...data, authRaw: randomUUID() }; vault.write(changed); assert.deepEqual(vault.read(), changed);
  assert.equal(fs.existsSync(`${file}.pending`), false);
  console.log('PASS: native Windows DPAPI protection, atomic replacement and decryption.');
  fs.rmSync(directory, { recursive: true, force: true }); app.exit(0);
} catch (error) { console.error(error.message); fs.rmSync(directory, { recursive: true, force: true }); app.exit(1); }
