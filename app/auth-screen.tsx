"use client";

import type { Dispatch, FormEvent, SetStateAction } from "react";

type AuthMode = "login" | "register" | "setup";
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
  setupAvailable: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

/**
 * Authentication UI is intentionally kept outside the guide workspace.
 * Guide content can evolve without changing this access boundary.
 */
export function AuthScreen({ mode, setMode, form, setForm, error, busy, setupAvailable, onSubmit }: AuthScreenProps) {
  const isRegister = mode === "register";
  const isSetup = mode === "setup";
  const isGithubPages = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_GITHUB_PAGES === "true";
  const update = (key: keyof AuthFormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <main className="access-page">
      <aside className="access-story" aria-labelledby="access-story-title">
        <div className="access-story-intro">
          <span className="access-story-kicker">GUIA COMERCIAL · MULT PORTAS</span>
          <h2 id="access-story-title">Sua rotina comercial, <em>em um só lugar.</em></h2>
          <p>Da primeira conversa até o próximo retorno, tenha as informações que ajudam a atender com clareza.</p>
        </div>
        <div className="access-door" aria-hidden="true">
          <svg viewBox="0 0 180 220" fill="none" focusable="false">
            <path className="access-door-frame" d="M24 201V19h132v182" />
            <path className="access-door-leaf" d="M43 200V37h94v163" />
            <path className="access-door-detail" d="M52 47h76v143H52zM43 200h94M15 201h150" />
            <circle className="access-door-handle" cx="116" cy="121" r="4" />
          </svg>
        </div>
        <ol className="access-story-grid">
          <li><span>01</span><div><strong>Aprender</strong><p>Conheça materiais, medidas e catálogos com aulas por marca.</p></div></li>
          <li><span>02</span><div><strong>Atender</strong><p>Consulte o roteiro, prepare mensagens e monte requisições.</p></div></li>
          <li><span>03</span><div><strong>Acompanhar</strong><p>Organize retornos, pendências e a prática de atendimento.</p></div></li>
        </ol>
        <p className="access-story-foot">MULT PORTAS · GUIA PARA A EQUIPE</p>
      </aside>

      <section className="access-panel" aria-labelledby="auth-title">
        <div className="auth-brand access-brand">
          <div className="brand-mark auth-mark">MP</div>
          <div>
            <strong>MULT PORTAS</strong>
            <span>Guia comercial interno</span>
          </div>
        </div>
        <div className="auth-heading access-heading">
          <span className="section-kicker">{isSetup ? "PRIMEIRO ACESSO" : "ACESSO DA EQUIPE"}</span>
          <h1 id="auth-title">{isSetup ? "Defina seu acesso." : isRegister ? "Crie seu acesso." : "Entre no seu espaço."}</h1>
          <p>{isSetup ? "Escolha e confirme a senha deste acesso. A configuração ficará salva neste navegador." : isRegister ? "Cada funcionário terá seus próprios registros, pendências e progresso." : "Use seu usuário e senha para abrir os dados da sua conta."}</p>
        </div>

        <div className="auth-tabs" role="group" aria-label="Acesso e cadastro">
          <button type="button" aria-pressed={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
            Entrar
          </button>
          <button type="button" aria-pressed={isRegister} className={isRegister ? "active" : ""} onClick={() => setMode("register")}>
            Cadastro
          </button>
        </div>
        {isGithubPages && setupAvailable && mode !== "register" && form.username.trim().toLocaleLowerCase("pt-BR") === "admin" && <button type="button" className={"access-admin-link" + (isSetup ? " active" : "")} aria-pressed={isSetup} onClick={() => setMode("setup")}>Configurar este acesso <span aria-hidden="true">→</span></button>}

        <form className="auth-form" onSubmit={onSubmit} aria-describedby={error ? "auth-error" : undefined}>
          {isRegister && (
            <label>
              <span>Nome completo</span>
              <input value={form.displayName} onChange={(event) => update("displayName", event.target.value)} placeholder="Nome do funcionário" autoComplete="name" minLength={2} maxLength={80} required />
            </label>
          )}
          <label>
            <span>Usuário</span>
            <input value={form.username} onChange={(event) => update("username", event.target.value)} placeholder="ex.: nome.sobrenome" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={3} maxLength={40} pattern="[a-zA-Z0-9._-]+" disabled={isSetup} required />
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
            <input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} placeholder={isRegister ? "Mínimo de 8 caracteres" : isSetup ? "Mínimo de 5 caracteres" : "Digite sua senha"} autoComplete={isRegister || isSetup ? "new-password" : "current-password"} minLength={isRegister ? 8 : isSetup ? 5 : undefined} maxLength={120} required />
          </label>
          {(isRegister || isSetup) && (
            <label>
              <span>Confirmar senha</span>
              <input type="password" value={form.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} placeholder="Repita a senha" autoComplete="new-password" minLength={isSetup ? 5 : 8} maxLength={120} required />
            </label>
          )}
          {error && <div className="auth-error" id="auth-error" role="alert">{error}</div>}
          <button className="button primary auth-submit" type="submit" disabled={busy}>
            {busy ? "Aguarde…" : isSetup ? "Salvar este acesso" : isRegister ? "Criar cadastro" : "Entrar no guia"}
            {!busy && <span>→</span>}
          </button>
        </form>

        <div className="auth-note"><span>✓</span><p>{isGithubPages
          ? "Cada conta guarda seus registros neste navegador e aparelho. Em outro aparelho, os cadastros e o progresso não aparecem automaticamente. Este login local não protege dados sensíveis."
          : "Ao sair, somente a sessão deste guia será encerrada. O acesso ao restante da plataforma permanece como está."}</p></div>
      </section>
    </main>
  );
}
