"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";

type AuthMode = "login" | "register";
type Branch = "Araraquara" | "São Carlos";

type AuthFormState = {
  displayName: string;
  username: string;
  branch: Branch;
  password: string;
  confirmPassword: string;
};

type AuthScreenProps = {
  mode: AuthMode;
  setMode: (mode: AuthMode) => void;
  form: AuthFormState;
  setForm: Dispatch<SetStateAction<AuthFormState>>;
  error: string;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/**
 * Authentication UI is intentionally kept outside the guide workspace.
 * Guide content can evolve without changing this access boundary.
 */
export function AuthScreen({ mode, setMode, form, setForm, error, busy, onSubmit }: AuthScreenProps) {
  const isRegister = mode === "register";
  const update = (key: keyof AuthFormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <div className="brand-mark auth-mark">MP</div>
          <div>
            <strong>MULT PORTAS</strong>
            <span>Guia comercial interno</span>
          </div>
        </div>
        <div className="auth-heading">
          <span className="section-kicker">ACESSO DOS FUNCIONÁRIOS</span>
          <h1 id="auth-title">{isRegister ? "Crie seu acesso." : "Entre no seu espaço."}</h1>
          <p>{isRegister ? "Cada funcionário terá seus próprios registros, pendências e progresso." : "Use seu usuário e senha para abrir os dados da sua conta."}</p>
        </div>

        <div className="auth-tabs" role="group" aria-label="Acesso e cadastro">
          <button type="button" aria-pressed={!isRegister} className={!isRegister ? "active" : ""} onClick={() => setMode("login")}>
            Entrar
          </button>
          <button type="button" aria-pressed={isRegister} className={isRegister ? "active" : ""} onClick={() => setMode("register")}>
            Cadastro
          </button>
        </div>

        <form className="auth-form" onSubmit={onSubmit} aria-describedby={error ? "auth-error" : undefined}>
          {isRegister && (
            <label>
              <span>Nome completo</span>
              <input value={form.displayName} onChange={(event) => update("displayName", event.target.value)} placeholder="Nome do funcionário" autoComplete="name" minLength={2} maxLength={80} required />
            </label>
          )}
          <label>
            <span>Usuário</span>
            <input value={form.username} onChange={(event) => update("username", event.target.value)} placeholder="ex.: nome.sobrenome" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={40} pattern="[a-zA-Z0-9._-]+" required />
          </label>
          {isRegister && (
            <label>
              <span>Filial</span>
              <select value={form.branch} onChange={(event) => update("branch", event.target.value)}>
                <option value="Araraquara">Araraquara</option>
                <option value="São Carlos">São Carlos</option>
              </select>
            </label>
          )}
          <label>
            <span>Senha</span>
            <input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} placeholder={isRegister ? "Mínimo de 8 caracteres" : "Digite sua senha"} autoComplete={isRegister ? "new-password" : "current-password"} minLength={isRegister ? 8 : undefined} maxLength={120} required />
          </label>
          {isRegister && (
            <label>
              <span>Confirmar senha</span>
              <input type="password" value={form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} placeholder="Repita a senha" autoComplete="new-password" minLength={8} maxLength={120} required />
            </label>
          )}
          {error && <div className="auth-error" id="auth-error" role="alert">{error}</div>}
          <button className="button primary auth-submit" type="submit" disabled={busy}>
            {busy ? "Aguarde…" : isRegister ? "Criar cadastro" : "Entrar no guia"}
            {!busy && <span>→</span>}
          </button>
        </form>

        <div className="auth-note"><span>✓</span><p>Ao sair, somente a sessão deste guia será encerrada. O acesso ao restante da plataforma permanece como está.</p></div>
      </section>
    </main>
  );
}
