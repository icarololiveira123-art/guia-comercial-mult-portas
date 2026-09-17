import { normalizeUsername } from "../../auth/_lib";

const allowedBranches = new Set(["Araraquara", "São Carlos"]);

export type EmployeeProfileInput = {
  displayName: string;
  username: string;
  usernameNormalized: string;
  branch: string;
  password: string;
};

export function parseEmployeeProfile(body: unknown, options: { passwordRequired: boolean }) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { value: null, error: "Não foi possível ler os dados do funcionário." };
  }

  const source = body as Record<string, unknown>;
  const displayName = typeof source.displayName === "string" ? source.displayName.trim() : "";
  const username = typeof source.username === "string" ? source.username.trim() : "";
  const usernameNormalized = normalizeUsername(username);
  const branch = typeof source.branch === "string" ? source.branch.trim() : "";
  const password = typeof source.password === "string" ? source.password : "";

  if (displayName.length < 2 || displayName.length > 80) {
    return { value: null, error: "Informe o nome completo do funcionário." };
  }
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
    return { value: null, error: "O usuário deve ter de 3 a 40 caracteres, sem espaços." };
  }
  if (usernameNormalized === "admin") {
    return { value: null, error: "Esse usuário já está reservado." };
  }
  if (!allowedBranches.has(branch)) {
    return { value: null, error: "Selecione Araraquara ou São Carlos." };
  }
  if (options.passwordRequired && (password.length < 8 || password.length > 120)) {
    return { value: null, error: "A senha deve ter pelo menos 8 caracteres." };
  }
  if (!options.passwordRequired && password && password.length < 8) {
    return { value: null, error: "A nova senha deve ter pelo menos 8 caracteres." };
  }
  if (!options.passwordRequired && password.length > 120) {
    return { value: null, error: "A nova senha deve ter no máximo 120 caracteres." };
  }

  return {
    value: { displayName, username, usernameNormalized, branch, password } satisfies EmployeeProfileInput,
    error: null,
  };
}
