import { and, eq, lt } from "drizzle-orm";
import { getDb } from "../../../db";
import { employeeSessions, employeeUsers } from "../../../db/schema";

export const SESSION_COOKIE = "mp_employee_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;
export const LEGACY_PASSWORD_HASH_ITERATIONS = 100_000;
export const PASSWORD_HASH_ITERATIONS = 100_000;
const PASSWORD_HASH_ALGORITHM = "pbkdf2-sha256";

export type EmployeeUser = {
  id: number;
  username: string;
  displayName: string;
  branch: string;
};

function encodeBytes(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function normalizeUsername(value: string) {
  return value.trim().toLocaleLowerCase("pt-BR");
}

export function makeToken() {
  return encodeBytes(crypto.getRandomValues(new Uint8Array(32)));
}

export async function digest(value: string) {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return encodeBytes(new Uint8Array(result));
}

export async function hashPassword(password: string, salt = makeToken(), iterations = PASSWORD_HASH_ITERATIONS) {
  // The hosted Worker enforces a hard PBKDF2 ceiling of 100,000 iterations.
  // Keep the value explicit here so local Node tests cannot accidentally accept
  // a hash configuration that production rejects.
  if (iterations !== PASSWORD_HASH_ITERATIONS) {
    throw new RangeError("Configuração de senha incompatível com o ambiente de produção.");
  }
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations, hash: "SHA-256" }, key, 256);
  const hash = encodeBytes(new Uint8Array(derived));
  return { salt, hash, iterations, encoded: `${PASSWORD_HASH_ALGORITHM}$${iterations}$${salt}$${hash}` };
}

export async function verifyPassword(password: string, storedValue: string) {
  const versioned = storedValue.split("$");
  const isVersioned = versioned.length === 4 && versioned[0] === PASSWORD_HASH_ALGORITHM;
  const iterations = isVersioned ? Number.parseInt(versioned[1], 10) : LEGACY_PASSWORD_HASH_ITERATIONS;
  const salt = isVersioned ? versioned[2] : storedValue.split(".")[0];
  const expectedHash = isVersioned ? versioned[3] : storedValue.split(".")[1];
  if (!salt || !expectedHash || !Number.isInteger(iterations) || iterations !== PASSWORD_HASH_ITERATIONS) return false;
  const actualHash = (await hashPassword(password, salt, iterations)).hash;
  return constantTimeEqual(actualHash, expectedHash);
}

export function passwordNeedsRehash(storedValue: string) {
  const [algorithm, iterationText] = storedValue.split("$");
  return algorithm !== PASSWORD_HASH_ALGORITHM || Number.parseInt(iterationText, 10) !== PASSWORD_HASH_ITERATIONS;
}

export function passwordRequiresReset(storedValue: string) {
  const [algorithm, iterationText] = storedValue.split("$");
  const iterations = Number.parseInt(iterationText, 10);
  return algorithm === PASSWORD_HASH_ALGORITHM && Number.isInteger(iterations) && iterations > PASSWORD_HASH_ITERATIONS;
}

export function constantTimeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

export function getCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const piece of header.split(";")) {
    const [key, ...value] = piece.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

function isCrossOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin !== new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function sessionCookie(request: Request, token: string, maxAge = SESSION_MAX_AGE) {
  const secureRequest = new URL(request.url).protocol === "https:";
  const secure = secureRequest ? "; Secure" : "";
  const sameSite = secureRequest && isCrossOriginRequest(request) ? "None" : "Lax";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`;
}

export function clearedSessionCookie(request: Request) {
  return sessionCookie(request, "", 0);
}

export async function getSessionUser(request: Request): Promise<EmployeeUser | null> {
  const token = getCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const tokenHash = await digest(token);
  const db = await getDb();
  const [row] = await db
    .select({
      id: employeeUsers.id,
      username: employeeUsers.username,
      displayName: employeeUsers.displayName,
      branch: employeeUsers.branch,
      expiresAt: employeeSessions.expiresAt,
      sessionId: employeeSessions.id,
    })
    .from(employeeSessions)
    .innerJoin(employeeUsers, eq(employeeSessions.userId, employeeUsers.id))
    .where(and(eq(employeeSessions.tokenHash, tokenHash)))
    .limit(1);

  if (!row) return null;
  if (Date.parse(row.expiresAt) <= Date.now()) {
    await db.delete(employeeSessions).where(eq(employeeSessions.id, row.sessionId));
    return null;
  }

  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    branch: row.branch,
  };
}

export async function createSession(request: Request, userId: number) {
  const token = makeToken();
  const db = await getDb();
  await db.delete(employeeSessions).where(lt(employeeSessions.expiresAt, new Date().toISOString())).run();
  await db.insert(employeeSessions).values({
    userId,
    tokenHash: await digest(token),
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString(),
  }).run();
  return { token, cookie: sessionCookie(request, token) };
}

export async function deleteSession(request: Request) {
  const token = getCookie(request, SESSION_COOKIE);
  if (token) {
    const db = await getDb();
    await db.delete(employeeSessions).where(eq(employeeSessions.tokenHash, await digest(token)));
  }
}

export function userPayload(user: EmployeeUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    branch: user.branch,
  };
}
