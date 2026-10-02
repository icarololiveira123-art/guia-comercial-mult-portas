"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type Branch = "Araraquara" | "São Carlos";
type AccountSummary = {
  learningIndex: number;
  averageScore: number;
  rounds: number;
  bestScore: number;
  scenariosPracticed: number;
  weakestSkill: string | null;
  lastPracticedAt: string | null;
  quotes: number;
  closed: number;
  pendingFollowUps: number;
  preparedFactoryItems: number;
};
type AccountRecord = {
  id: number;
  username: string;
  displayName: string;
  branch: Branch;
  createdAt: string;
  dataUpdatedAt: string | null;
  summary?: AccountSummary;
};
type AccountEditorState = {
  id: number | null;
  displayName: string;
  username: string;
  branch: Branch;
  password: string;
  confirmPassword: string;
};
type AccountCenterProps = {
  onLogout: () => Promise<void>;
  externalError?: string;
  isGithubPages: boolean;
  request: (path: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
};

const emptySummary: AccountSummary = {
  learningIndex: 0,
  averageScore: 0,
  rounds: 0,
  bestScore: 0,
  scenariosPracticed: 0,
  weakestSkill: null,
  lastPracticedAt: null,
  quotes: 0,
  closed: 0,
  pendingFollowUps: 0,
  preparedFactoryItems: 0,
};

function blankEditor(id: number | null = null): AccountEditorState {
  return { id, displayName: "", username: "", branch: "Araraquara", password: "", confirmPassword: "" };
}

function formatDate(value: string | null) {
  if (!value) return "Ainda não usado";
  const date = new Date(value.split("|", 1)[0]);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

async function responseJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  if (!raw.trim()) throw new Error("Não foi possível ler a resposta. Tente novamente.");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("A resposta recebida é inválida. Tente novamente.");
  }
}

export function AccountCenter({ onLogout, externalError, isGithubPages, request }: AccountCenterProps) {
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<AccountRecord | null>(null);
  const [selectedState, setSelectedState] = useState<Record<string, unknown> | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<AccountSummary>(emptySummary);
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<"Todas" | Branch>("Todas");
  const [editor, setEditor] = useState<AccountEditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [editorBusy, setEditorBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const detailsRequestRef = useRef<{ id: number; controller: AbortController } | null>(null);
  const detailsRequestIdRef = useRef(0);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await request("/api/admin/users", { cache: "no-store" });
      const payload = await responseJson<{ users?: AccountRecord[]; error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as contas.");
      setAccounts(Array.isArray(payload.users) ? payload.users : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Não foi possível carregar as contas.");
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadAccounts(); }, 0);
    return () => {
      window.clearTimeout(timer);
      detailsRequestRef.current?.controller.abort();
    };
  }, [loadAccounts]);

  async function openAccount(account: AccountRecord) {
    detailsRequestRef.current?.controller.abort();
    const requestId = ++detailsRequestIdRef.current;
    const controller = new AbortController();
    detailsRequestRef.current = { id: requestId, controller };
    setEditor(null);
    setSelectedAccount(account);
    setSelectedState(null);
    setSelectedSummary(account.summary ?? emptySummary);
    setDetailsError("");
    setDetailsLoading(true);
    try {
      const response = await request(`/api/admin/users/${account.id}`, { cache: "no-store", signal: controller.signal });
      if (detailsRequestRef.current?.id !== requestId) return;
      const payload = await responseJson<{ user?: AccountRecord; state?: unknown; summary?: AccountSummary; error?: string }>(response);
      if (detailsRequestRef.current?.id !== requestId) return;
      if (!response.ok || !payload.user) throw new Error(payload.error || "Não foi possível abrir os dados da conta.");
      setSelectedAccount(payload.user);
      setSelectedState(payload.state && typeof payload.state === "object" && !Array.isArray(payload.state)
        ? payload.state as Record<string, unknown> : null);
      setSelectedSummary(payload.summary ?? payload.user.summary ?? emptySummary);
    } catch (loadError) {
      if (controller.signal.aborted || detailsRequestRef.current?.id !== requestId) return;
      setDetailsError(loadError instanceof Error ? loadError.message : "Não foi possível abrir os dados da conta.");
    } finally {
      if (detailsRequestRef.current?.id === requestId) {
        detailsRequestRef.current = null;
        setDetailsLoading(false);
      }
    }
  }

  function closeDetails() {
    detailsRequestRef.current?.controller.abort();
    detailsRequestRef.current = null;
    setDetailsLoading(false);
    setDetailsError("");
    setSelectedAccount(null);
    setSelectedState(null);
    setSelectedSummary(emptySummary);
  }

  function startCreate() {
    setError("");
    setNotice("");
    closeDetails();
    setEditor(blankEditor());
  }

  function startEdit(account: AccountRecord) {
    setError("");
    setNotice("");
    closeDetails();
    setEditor({ id: account.id, displayName: account.displayName, username: account.username,
      branch: account.branch, password: "", confirmPassword: "" });
  }

  async function saveAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor) return;
    setError("");
    setNotice("");
    if (editor.password !== editor.confirmPassword) {
      setError("As senhas não coincidem.");
      return;
    }
    if (editor.id === null && editor.password.length < 8) {
      setError("A senha deve ter pelo menos 8 caracteres.");
      return;
    }
    if (editor.id !== null && editor.password && editor.password.length < 8) {
      setError("A nova senha deve ter pelo menos 8 caracteres.");
      return;
    }

    setEditorBusy(true);
    try {
      const response = await request(editor.id === null ? "/api/admin/users" : `/api/admin/users/${editor.id}`, {
        method: editor.id === null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: editor.displayName, username: editor.username,
          branch: editor.branch, password: editor.password }),
      });
      const payload = await responseJson<{ user?: AccountRecord; error?: string }>(response);
      if (!response.ok || !payload.user) throw new Error(payload.error || "Não foi possível salvar o funcionário.");
      const wasNew = editor.id === null;
      setEditor(null);
      closeDetails();
      await loadAccounts();
      setNotice(wasNew ? "Funcionário criado com sucesso." : "Perfil atualizado com sucesso.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Não foi possível salvar o funcionário.");
    } finally {
      setEditorBusy(false);
    }
  }

  async function deleteAccount(account: AccountRecord) {
    if (!window.confirm(`Apagar o perfil de ${account.displayName}? Os registros e o acesso dessa conta também serão removidos.`)) return;
    setError("");
    setNotice("");
    setDeletingId(account.id);
    try {
      const response = await request(`/api/admin/users/${account.id}`, { method: "DELETE" });
      const payload = await responseJson<{ error?: string }>(response);
      if (!response.ok) throw new Error(payload.error || "Não foi possível apagar o funcionário.");
      if (selectedAccount?.id === account.id) closeDetails();
      if (editor?.id === account.id) setEditor(null);
      await loadAccounts();
      setNotice("Funcionário apagado com sucesso.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Não foi possível apagar o funcionário.");
    } finally {
      setDeletingId(null);
    }
  }

  const visibleAccounts = accounts.filter((account) => {
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    return (!needle || `${account.displayName} ${account.username}`.toLocaleLowerCase("pt-BR").includes(needle))
      && (branchFilter === "Todas" || account.branch === branchFilter);
  });
  const trained = accounts.filter((account) => (account.summary?.rounds ?? 0) > 0);
  const averageLearning = trained.length
    ? Math.round(trained.reduce((total, account) => total + (account.summary?.learningIndex ?? 0), 0) / trained.length)
    : 0;
  const stateEntries = selectedState ? Object.entries(selectedState).filter(([, value]) => value !== undefined && value !== null) : [];

  return (
    <main className="admin-page">
      <div className="admin-frame">
        <header className="admin-masthead">
          <div className="auth-brand">
            <div className="brand-mark auth-mark">MP</div>
            <div><strong>MULT PORTAS</strong><span>Gestão de funcionários</span></div>
          </div>
          <div className="account-actions">
            <button className="button primary account-new" type="button" onClick={startCreate}>Novo funcionário <span aria-hidden="true">+</span></button>
            <button className="button account-refresh" type="button" onClick={() => void loadAccounts()} disabled={loading} aria-busy={loading}>
              <span aria-hidden="true">{loading ? "…" : "↻"}</span>{loading ? "Atualizando…" : "Atualizar"}
            </button>
            <button className="logout-button account-logout" type="button" onClick={() => void onLogout()}>Sair</button>
          </div>
        </header>

        <div className="account-heading admin-hero">
          <span className="section-kicker">PAINEL ADMINISTRATIVO</span>
          <h1>Equipe em um só lugar.</h1>
          <p>Organize os acessos, acompanhe o aprendizado e consulte os registros de cada pessoa.</p>
          {isGithubPages && <small className="admin-local-note">Os dados deste painel pertencem a este navegador e aparelho.</small>}
        </div>

        <section className="admin-summary account-overview" aria-label="Resumo da equipe">
          <div><strong>{accounts.length}</strong><span>Funcionários</span><small>perfis com dados separados</small></div>
          <div><strong>{accounts.filter((account) => account.dataUpdatedAt).length}</strong><span>Contas utilizadas</span><small>{isGithubPages ? "com registros neste navegador" : "com registros sincronizados"}</small></div>
          <div><strong>{trained.length}</strong><span>Em treinamento</span><small>com pelo menos uma rodada</small></div>
          <div><strong>{trained.length ? `${averageLearning}/100` : "—"}</strong><span>Aprendizado médio</span><small>de quem já treinou</small></div>
        </section>

        {(error || externalError) && <div className="auth-error" role="alert">{error || externalError}</div>}
        {notice && <div className="account-notice" role="status">✓ {notice}</div>}

        <div className="admin-workspace">
          <section className="admin-directory" aria-labelledby="admin-directory-title">
            <div className="admin-directory-head">
              <div><span className="section-kicker">DIRETÓRIO</span><h2 id="admin-directory-title">Funcionários</h2></div>
              <span className="admin-count">{visibleAccounts.length} de {accounts.length}</span>
            </div>
            <div className="admin-directory-controls account-filters">
              <label><span>Buscar funcionário</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nome ou usuário" type="search" /></label>
              <label><span>Filial</span><select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value as typeof branchFilter)}><option>Todas</option><option>Araraquara</option><option>São Carlos</option></select></label>
            </div>
            <div className="admin-directory-list account-list" aria-live="polite">
              {loading ? (
                <div className="account-empty">Carregando contas…</div>
              ) : accounts.length === 0 ? (
                <div className="account-empty">Nenhuma conta cadastrada. Use “Novo funcionário” para começar.</div>
              ) : visibleAccounts.length === 0 ? (
                <div className="account-empty">Nenhum funcionário corresponde aos filtros.</div>
              ) : visibleAccounts.map((account) => (
                <article className={`admin-person ${selectedAccount?.id === account.id || editor?.id === account.id ? "selected" : ""}`} key={account.id}>
                  <button className="admin-person-open" type="button" onClick={() => void openAccount(account)} aria-label={`Abrir dados de ${account.displayName}`} aria-pressed={selectedAccount?.id === account.id}>
                    <span className="account-avatar" aria-hidden="true">{account.displayName.slice(0, 1).toUpperCase()}</span>
                    <span className="account-main"><strong>{account.displayName}</strong><span>{account.username} · {account.branch}</span></span>
                    <span className="admin-person-date">{account.dataUpdatedAt ? `Usado ${formatDate(account.dataUpdatedAt)}` : "Ainda sem registros"}</span>
                    <span className="admin-person-arrow" aria-hidden="true">→</span>
                  </button>
                  <div className="admin-person-actions">
                    <button className="account-edit" type="button" onClick={() => startEdit(account)} aria-label={`Editar ${account.displayName}`}>Editar</button>
                    <button className="account-delete" type="button" onClick={() => void deleteAccount(account)} disabled={deletingId === account.id} aria-label={`Apagar ${account.displayName}`}>
                      {deletingId === account.id ? "Apagando…" : "Apagar"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="admin-inspector" aria-label="Detalhes do funcionário">
            {editor ? (
              <div className="account-editor" aria-labelledby="account-editor-title">
                <div className="account-detail-head">
                  <div><span className="section-kicker">{editor.id === null ? "NOVO FUNCIONÁRIO" : "EDITAR PERFIL"}</span>
                    <h2 id="account-editor-title">{editor.id === null ? "Criar acesso" : "Atualizar dados"}</h2>
                    <p>{editor.id === null ? "O perfil já ficará pronto para entrar no guia." : "Deixe a senha em branco para mantê-la como está."}</p>
                  </div>
                  <button className="text-button" type="button" onClick={() => !editorBusy && setEditor(null)} disabled={editorBusy}>Fechar <span aria-hidden="true">×</span></button>
                </div>
                <form className="account-editor-form" onSubmit={saveAccount}>
                  <label><span>Nome completo</span><input value={editor.displayName} onChange={(event) => setEditor((current) => current ? { ...current, displayName: event.target.value } : current)} autoComplete="name" required /></label>
                  <label><span>Usuário</span><input value={editor.username} onChange={(event) => setEditor((current) => current ? { ...current, username: event.target.value } : current)} autoComplete="username" required /></label>
                  <label><span>Filial</span><select value={editor.branch} onChange={(event) => setEditor((current) => current ? { ...current, branch: event.target.value as Branch } : current)}><option value="Araraquara">Araraquara</option><option value="São Carlos">São Carlos</option></select></label>
                  <label><span>{editor.id === null ? "Senha" : "Nova senha (opcional)"}</span><input type="password" value={editor.password} onChange={(event) => setEditor((current) => current ? { ...current, password: event.target.value } : current)} placeholder={editor.id === null ? "Mínimo de 8 caracteres" : "Deixe em branco para manter"} autoComplete="new-password" minLength={editor.id === null || editor.password ? 8 : undefined} maxLength={120} required={editor.id === null} /></label>
                  <label><span>Confirmar senha</span><input type="password" value={editor.confirmPassword} onChange={(event) => setEditor((current) => current ? { ...current, confirmPassword: event.target.value } : current)} placeholder="Repita a senha" autoComplete="new-password" minLength={editor.id === null || editor.password ? 8 : undefined} maxLength={120} required={editor.id === null || Boolean(editor.password)} /></label>
                  <div className="account-editor-actions"><button className="button ghost account-cancel" type="button" onClick={() => setEditor(null)} disabled={editorBusy}>Cancelar</button><button className="button primary" type="submit" disabled={editorBusy}>{editorBusy ? "Salvando…" : editor.id === null ? "Criar funcionário" : "Salvar alterações"}<span aria-hidden="true">→</span></button></div>
                </form>
              </div>
            ) : selectedAccount ? (
              <div className="account-detail" aria-live="polite">
                <div className="account-detail-head">
                  <div><span className="section-kicker">REGISTROS DA CONTA</span><h2>{selectedAccount.displayName}</h2><p>{selectedAccount.username} · {selectedAccount.branch}</p></div>
                  <button className="text-button" type="button" onClick={closeDetails}>Fechar <span aria-hidden="true">×</span></button>
                </div>
                {detailsLoading ? (
                  <div className="account-empty">Abrindo registros…</div>
                ) : detailsError ? (
                  <div className="auth-error" role="alert">{detailsError}</div>
                ) : (
                  <>
                    <div className="account-performance-grid">
                      <article><span>Aprendizado</span><strong>{selectedSummary.learningIndex}/100</strong><small>{selectedSummary.rounds ? `${selectedSummary.rounds} rodadas · média ${selectedSummary.averageScore}/10` : "Treinamento ainda não iniciado"}</small></article>
                      <article><span>Melhor resultado</span><strong>{selectedSummary.bestScore ? `${selectedSummary.bestScore}/10` : "—"}</strong><small>{selectedSummary.scenariosPracticed} cenários praticados</small></article>
                      <article><span>Carteira informada</span><strong>{selectedSummary.quotes}</strong><small>{selectedSummary.closed} vendas fechadas</small></article>
                      <article><span>Ações abertas</span><strong>{selectedSummary.pendingFollowUps}</strong><small>{selectedSummary.preparedFactoryItems} itens preparados para fábrica</small></article>
                    </div>
                    <p className="admin-inspector-meta">Cadastro: {formatDate(selectedAccount.createdAt)} · Último registro: {selectedAccount.dataUpdatedAt ? formatDate(selectedAccount.dataUpdatedAt) : "sem dados"}</p>
                    {stateEntries.length === 0 ? (
                      <div className="account-empty">Esta conta ainda não possui registros salvos.</div>
                    ) : (
                      <details className="account-raw-data">
                        <summary>Ver dados técnicos da conta</summary>
                        <p>Visualização para auditoria. Os registros continuam separados por funcionário.</p>
                        <div className="account-state-grid">
                          {stateEntries.map(([key, value]) => (
                            <article key={key}><span>{key}</span><pre>{JSON.stringify(value, null, 2)}</pre></article>
                          ))}
                        </div>
                      </details>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="admin-inspector-empty">
                <span className="section-kicker">VISÃO INDIVIDUAL</span>
                <div className="admin-inspector-icon" aria-hidden="true">MP</div>
                <h2>Os dados de cada pessoa, com clareza.</h2>
                <p>Selecione um funcionário para acompanhar o treinamento e consultar os registros, ou crie um novo acesso.</p>
                <button className="button primary" type="button" onClick={startCreate}>Novo funcionário <span aria-hidden="true">+</span></button>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
