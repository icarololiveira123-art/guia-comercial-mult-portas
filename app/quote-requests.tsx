"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { WorkspaceIcon } from "./workspace-icon";
import {
  QUOTE_ITEM_LIMIT, buildQuoteRequestSummary, formatQuoteDate, isQuoteId, quoteToday, validateQuoteFields,
  type QuoteRequestFields, type QuoteRequestItem, type QuoteRequestRecord, type QuoteRequestVersion,
} from "./lib/quote-requests.mjs";
import { formatQuoteAmount, parseQuoteAmount, QUOTE_AMOUNT_ERROR, quoteAmountInput } from "./lib/quote-amount.mjs";

type Props = { userId: number; request: (path: string, init?: RequestInit) => Promise<Response>; active: boolean };
type Draft = { id: string; baseRevision: number | null; fields: QuoteRequestFields; amountText: string; mutationId: string; dirty: boolean; createdAt: string | null };
type Counts = { total: number; pending: number; sent: number; archived: number };
type ListReply = { requests: QuoteRequestRecord[]; counts: Counts; nextCursor: string | null };
type HistoryReply = { request: QuoteRequestRecord; versions: QuoteRequestVersion[]; nextBefore: number | null };
type Conflict = { request: QuoteRequestRecord | null };
const actions: Record<string, string> = { created: "Pedido criado", updated: "Dados atualizados", sent: "Marcado como enviado", unsent: "Marcado como não enviado", archived: "Pedido arquivado", restored: "Pedido restaurado" };
const uid = () => crypto.randomUUID();
const newItem = (): QuoteRequestItem => ({ id: uid(), description: "", height: "", width: "", measurements: "", quantity: 1, details: "" });
function emptyDraft(): Draft {
  return { id: uid(), baseRevision: null, fields: { clientName: "", contact: "", requestedOn: quoteToday(), notes: "", sent: false, amountCents: null, items: [newItem()] }, amountText: "", mutationId: uid(), dirty: false, createdAt: null };
}
function editDraft(record: QuoteRequestRecord): Draft {
  return { id: record.id, baseRevision: record.revision, fields: { clientName: record.clientName, contact: record.contact, requestedOn: record.requestedOn, notes: record.notes, sent: record.sent, amountCents: record.amountCents ?? null, items: record.items.map(item => ({ ...item, height: item.height ?? "", width: item.width ?? "" })) }, amountText: quoteAmountInput(record.amountCents), mutationId: uid(), dirty: false, createdAt: record.createdAt };
}
function readDraft(key: string): Draft {
  const fresh = emptyDraft();
  if (typeof window === "undefined") return fresh;
  try {
    const value = JSON.parse(window.localStorage.getItem(key) || "null") as Draft | null;
    if (!value || !value.dirty || !isQuoteId(value.id) || !isQuoteId(value.mutationId) || !value.fields || typeof value.amountText !== "string" || value.amountText.length > 40 || !Array.isArray(value.fields.items) || !value.fields.items.length || value.fields.items.length > QUOTE_ITEM_LIMIT) return fresh;
    if (value.baseRevision !== null && (!Number.isSafeInteger(value.baseRevision) || value.baseRevision < 1)) return fresh;
    // An unfinished form can have blank fields; validate its shape without requiring completion.
    if ([value.fields.clientName, value.fields.contact, value.fields.requestedOn, value.fields.notes].some(item => typeof item !== "string") || typeof value.fields.sent !== "boolean") return fresh;
    if (value.fields.items.some(item => !item || !isQuoteId(item.id) || typeof item.description !== "string" || (item.height !== undefined && typeof item.height !== "string") || (item.width !== undefined && typeof item.width !== "string") || typeof item.measurements !== "string" || typeof item.details !== "string" || (item.quantity !== null && !Number.isFinite(item.quantity)))) return fresh;
    return { ...value, fields: { ...value.fields, amountCents: value.fields.amountCents ?? null, items: value.fields.items.map(item => ({ ...item, height: item.height ?? "", width: item.width ?? "", quantity: item.quantity === null ? NaN : item.quantity })) } };
  } catch { return fresh; }
}
class QuoteError extends Error {
  status: number;
  current: QuoteRequestRecord | null;
  constructor(message: string, status: number, current: QuoteRequestRecord | null = null) { super(message); this.status = status; this.current = current; }
}
function isAbort(error: unknown) { return error instanceof Error && error.name === "AbortError"; }
function messageOf(error: unknown) { return error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente."; }

export function QuoteRequests({ userId, request, active }: Props) {
  const storageKey = `mult-portas-quote-draft-v2:${userId}`;
  const [draft, setDraft] = useState<Draft>(() => readDraft(storageKey));
  const [scope, setScope] = useState<"active" | "history">("active");
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [searchReady, setSearchReady] = useState("");
  const [rows, setRows] = useState<QuoteRequestRecord[]>([]);
  const [counts, setCounts] = useState<Counts>({ total: 0, pending: 0, sent: 0, archived: 0 });
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [formError, setFormError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [pendingOpen, setPendingOpen] = useState<QuoteRequestRecord | "new" | null>(null);
  const [history, setHistory] = useState<HistoryReply | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const requestRef = useRef(request);
  const mounted = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const listController = useRef<AbortController | null>(null);
  const listGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const busyRef = useRef(false);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const summaryRef = useRef<HTMLTextAreaElement>(null);
  const historyHeading = useRef<HTMLHeadingElement>(null);
  const [manualCopy, setManualCopy] = useState("");

  useEffect(() => { requestRef.current = request; }, [request]);
  useEffect(() => {
    mounted.current = true;
    const pendingControllers = controllers.current;
    return () => { mounted.current = false; for (const controller of pendingControllers) controller.abort(); pendingControllers.clear(); };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let failed = false;
    try {
      if (draft.dirty) window.localStorage.setItem(storageKey, JSON.stringify(draft));
      else window.localStorage.removeItem(storageKey);
    } catch { failed = true; }
    queueMicrotask(() => { if (!cancelled) setStorageError(failed); });
    return () => { cancelled = true; };
  }, [draft, storageKey]);
  useEffect(() => {
    if (!draft.dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft.dirty]);
  useEffect(() => {
    const timer = window.setTimeout(() => setSearchReady(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const call = useCallback(async <T,>(path: string, init?: RequestInit, supplied?: AbortController): Promise<T> => {
    const controller = supplied ?? new AbortController();
    controllers.current.add(controller);
    try {
      const response = await requestRef.current(path, { ...init, signal: controller.signal });
      const body = await response.json();
      if (!mounted.current || controller.signal.aborted) throw new DOMException("Operação cancelada.", "AbortError");
      if (!response.ok) throw new QuoteError(typeof body.error === "string" ? body.error : "Não foi possível concluir. Tente novamente.", response.status, body.request ?? null);
      return body as T;
    } finally { controllers.current.delete(controller); }
  }, []);

  const loadList = useCallback(async (cursor?: string) => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    const generation = ++listGeneration.current;
    setLoading(true); setListError("");
    const params = new URLSearchParams({ scope, filter, search: searchReady });
    if (cursor) params.set("cursor", cursor);
    try {
      const result = await call<ListReply>(`/api/quote-requests?${params}`, undefined, controller);
      if (generation !== listGeneration.current) return;
      setRows(current => cursor ? [...current, ...result.requests.filter(item => !current.some(saved => saved.id === item.id))] : result.requests);
      setCounts(result.counts); setNextCursor(result.nextCursor);
    } catch (error) {
      if (!isAbort(error) && generation === listGeneration.current) setListError(messageOf(error));
    } finally { if (mounted.current && generation === listGeneration.current) setLoading(false); }
  }, [scope, filter, searchReady, call]);
  useEffect(() => {
    if (!active) { listController.current?.abort(); return; }
    const timer = window.setTimeout(() => { setRows([]); setNextCursor(null); void loadList(); }, 0);
    return () => { window.clearTimeout(timer); listController.current?.abort(); };
  }, [active, loadList, refresh]);

  function change(fields: Partial<QuoteRequestFields>) {
    setDraft(current => ({ ...current, fields: { ...current.fields, ...fields }, mutationId: uid(), dirty: true }));
    setFormError(""); setFeedback("");
  }
  function changeItem(id: string, fields: Partial<QuoteRequestItem>) {
    setDraft(current => ({ ...current, fields: { ...current.fields, items: current.fields.items.map(item => item.id === id ? { ...item, ...fields } : item) }, mutationId: uid(), dirty: true }));
    setFormError(""); setFeedback("");
  }
  function openEditor(record: QuoteRequestRecord | "new", discard = false) {
    if (busyRef.current) return;
    if (draft.dirty && !discard) { setPendingOpen(record); return; }
    setDraft(record === "new" ? emptyDraft() : editDraft(record));
    setPendingOpen(null); setConflict(null); setFormError(""); setFeedback("");
    window.requestAnimationFrame(() => { formHeading.current?.focus(); formHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" }); });
  }
  function putRecord(record: QuoteRequestRecord) {
    setRows(current => current.map(item => item.id === record.id ? record : item));
    setHistory(current => current?.request.id === record.id ? null : current);
    setRefresh(current => current + 1);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busyRef.current || conflict) return;
    setFormError(""); setFeedback("");
    const amount = parseQuoteAmount(draft.amountText);
    if (!amount.valid) { setFormError(QUOTE_AMOUNT_ERROR); return; }
    let fields: QuoteRequestFields;
    try { fields = validateQuoteFields({ ...draft.fields, amountCents: amount.amountCents }); }
    catch (error) { setFormError(messageOf(error)); return; }
    busyRef.current = true; setSaving(true);
    try {
      const result = await call<{ request: QuoteRequestRecord }>(draft.baseRevision === null ? "/api/quote-requests" : `/api/quote-requests/${draft.id}`, {
        method: draft.baseRevision === null ? "POST" : "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, id: draft.id, mutationId: draft.mutationId, ...(draft.baseRevision === null ? {} : { baseRevision: draft.baseRevision }) }),
      });
      setDraft(editDraft(result.request)); putRecord(result.request);
      setFeedback("Pedido salvo na sua conta. Você pode consultá-lo em outro computador com o mesmo login.");
    } catch (error) {
      if (!isAbort(error)) {
        if (error instanceof QuoteError && error.status === 409) setConflict({ request: error.current });
        else setFormError(`${messageOf(error)} Suas alterações continuam no formulário. Você pode tentar salvar novamente.`);
      }
    } finally { busyRef.current = false; if (mounted.current) setSaving(false); }
  }
  async function changeStatus(record: QuoteRequestRecord, action: string) {
    if (busyRef.current) return;
    if (draft.dirty && draft.id === record.id) { setFormError("Salve suas alterações neste pedido antes de mudar o status ou arquivá-lo."); formHeading.current?.focus(); return; }
    busyRef.current = true; setActionBusy(record.id); setFeedback(""); setActionError("");
    try {
      const result = await call<{ request: QuoteRequestRecord }>(`/api/quote-requests/${record.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseRevision: record.revision, mutationId: uid(), action }) });
      putRecord(result.request);
      if (draft.id === record.id) setDraft(editDraft(result.request));
      setFeedback(`${actions[action] ?? "Pedido atualizado"}. A alteração ficou registrada no histórico.`);
    } catch (error) {
      if (!isAbort(error)) { setActionError(messageOf(error)); if (error instanceof QuoteError && error.status === 409) setRefresh(current => current + 1); }
    } finally { busyRef.current = false; if (mounted.current) setActionBusy(null); }
  }
  async function loadHistory(record: QuoteRequestRecord, before?: number) {
    const generation = ++historyGeneration.current;
    setHistoryLoading(true); setHistoryError("");
    if (!before) { setHistory({ request: record, versions: [], nextBefore: null }); window.requestAnimationFrame(() => { historyHeading.current?.focus(); historyHeading.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }); }
    try {
      const result = await call<HistoryReply>(`/api/quote-requests/${record.id}/history${before ? `?before=${before}` : ""}`);
      if (generation !== historyGeneration.current) return;
      setHistory(current => before && current?.request.id === result.request.id ? { ...result, versions: [...current.versions, ...result.versions.filter(version => !current.versions.some(saved => saved.revision === version.revision))] } : result);
    } catch (error) { if (!isAbort(error) && generation === historyGeneration.current) setHistoryError(messageOf(error)); }
    finally { if (mounted.current && generation === historyGeneration.current) setHistoryLoading(false); }
  }
  async function copy(record: QuoteRequestRecord) {
    const summary = buildQuoteRequestSummary(record);
    try { await navigator.clipboard.writeText(summary); if (mounted.current) setFeedback("Resumo copiado. Cole na conversa do cliente."); }
    catch { if (mounted.current) { setManualCopy(summary); window.requestAnimationFrame(() => { summaryRef.current?.focus(); summaryRef.current?.select(); }); } }
  }
  const disabled = saving || actionBusy !== null;
  if (!active) return null;
  return <div className="page-content quote-page">
    <header className="quote-heading"><div><span className="section-kicker">OPERAÇÃO / DO PEDIDO AO ENVIO</span><h1>Pedidos de orçamento</h1><p>Cliente, medidas, valores e cada etapa do atendimento, no mesmo lugar.</p></div><button className="button dark" type="button" onClick={() => openEditor("new")} disabled={disabled}>Novo pedido <span aria-hidden="true">+</span></button></header>
    <div className="quote-metrics" aria-label="Resumo dos pedidos"><div><span>Total registrado</span><strong>{counts.total}</strong></div><div><span>Aguardando envio</span><strong>{counts.pending}</strong></div><div><span>Enviados · ativos</span><strong>{counts.sent}</strong></div><div><span>Arquivados</span><strong>{counts.archived}</strong></div></div>
    <p className="quote-feedback" role="status" aria-live="polite">{feedback}</p>
    {actionError && <div className="quote-error" role="alert">{actionError}</div>}
    {manualCopy && <div className="quote-copy-fallback"><label htmlFor="quote-copy-text">Use a opção Copiar do seu aparelho para copiar o resumo.</label><textarea id="quote-copy-text" ref={summaryRef} readOnly rows={5} value={manualCopy} /><button type="button" className="button" onClick={() => setManualCopy("")}>Fechar resumo</button></div>}
    <div className="quote-layout">
      <section className="quote-ledger" aria-labelledby="quote-list-title">
        <div className="quote-ledger-head"><span className="section-kicker">SUA CARTEIRA DE PEDIDOS</span><h2 id="quote-list-title">Acompanhe cada cliente.</h2><p>Arquivar organiza a lista e mantém todas as informações disponíveis no histórico.</p></div>
        <div className="quote-tabs" aria-label="Listas de pedidos"><button type="button" aria-pressed={scope === "active"} onClick={() => setScope("active")}>Em andamento</button><button type="button" aria-pressed={scope === "history"} onClick={() => setScope("history")}>Histórico completo</button></div>
        <div className="quote-filters"><label>Buscar cliente ou item<input type="search" maxLength={120} placeholder="Nome, produto, medida…" value={search} onChange={event => setSearch(event.target.value)} /></label><label>Envio ao cliente<select value={filter} onChange={event => setFilter(event.target.value)}><option value="all">Todos os status</option><option value="pending">Ainda não enviados</option><option value="sent">Enviados</option></select></label></div>
        {listError && <div className="quote-error" role="alert"><p>{listError}</p><button type="button" className="button" onClick={() => { void loadList(); }}>Tentar novamente</button></div>}
        <div className="quote-list" aria-busy={loading}>
          {rows.map(record => <article className={`quote-record${draft.id === record.id ? " is-selected" : ""}`} key={record.id}>
            <div className="quote-record-top"><div><h3>{record.clientName}</h3><p>{record.items.length} {record.items.length === 1 ? "item" : "itens"} · Solicitado em {formatQuoteDate(record.requestedOn)}</p></div><span className={`quote-badge${record.sent ? " sent" : ""}`}>{record.sent ? "Enviado" : "Não enviado"}</span></div>
            <p className="quote-record-preview">{record.items.map(item => [item.description, item.height ? `Altura: ${item.height}` : "", item.width ? `Largura: ${item.width}` : "", item.measurements].filter(Boolean).join(" · ")).join(" / ")}</p>
            <div className="quote-record-meta"><span>Criado {formatQuoteDate(record.createdAt, true)}</span><strong>{formatQuoteAmount(record.amountCents)}</strong>{record.archivedAt && <span className="quote-archive-label">Arquivado</span>}</div>
            <div className="quote-record-actions"><button type="button" onClick={() => openEditor(record)} disabled={disabled}>Editar pedido</button><button type="button" onClick={() => { void loadHistory(record); }} disabled={historyLoading}>Ver alterações</button><button type="button" onClick={() => { void copy(record); }}>Copiar resumo</button><button type="button" onClick={() => { void changeStatus(record, record.sent ? "unsent" : "sent"); }} disabled={disabled}>{record.sent ? "Marcar não enviado" : "Marcar enviado"}</button><button type="button" onClick={() => { void changeStatus(record, record.archivedAt ? "restored" : "archived"); }} disabled={disabled}>{actionBusy === record.id ? "Salvando…" : record.archivedAt ? "Restaurar pedido" : "Arquivar"}</button></div>
          </article>)}
          {!rows.length && !loading && !listError && <div className="quote-empty"><WorkspaceIcon name="work" /><strong>{searchReady || filter !== "all" ? "Nenhum pedido com esses filtros." : "Seu próximo atendimento começa aqui."}</strong><p>{searchReady || filter !== "all" ? "Tente outro nome ou altere os filtros." : "Preencha o cliente e os itens ao lado para criar o primeiro pedido."}</p></div>}
          {loading && <p className="quote-loading" role="status">Carregando pedidos…</p>}
        </div>
        {nextCursor && <button className="button quote-load-more" type="button" disabled={loading} onClick={() => { void loadList(nextCursor); }}>Carregar pedidos anteriores</button>}
        <p className="quote-ledger-note">Os pedidos salvos ficam na sua conta, sem exclusão automática com a passagem dos dias.</p>
      </section>

      <section className="quote-editor" aria-labelledby="quote-editor-title">
        <div className="quote-editor-head"><span className="section-kicker">{draft.baseRevision === null ? "UM NOVO ATENDIMENTO" : `EDITANDO · REVISÃO ${draft.baseRevision}`}</span><h2 id="quote-editor-title" tabIndex={-1} ref={formHeading}>{draft.baseRevision === null ? "Anote o pedido." : "Atualize o pedido."}</h2><p>{draft.createdAt ? `Criado em ${formatQuoteDate(draft.createdAt, true)}. A data de criação é preservada.` : "A data e a hora da criação serão registradas no primeiro salvamento."}</p></div>
        {pendingOpen && <div className="quote-warning" role="alert"><strong>Há alterações ainda não salvas.</strong><p>Salve este pedido ou descarte as alterações para abrir outro.</p><div className="quote-inline-actions"><button className="button dark" type="button" onClick={() => setPendingOpen(null)}>Continuar editando</button><button className="button" type="button" onClick={() => openEditor(pendingOpen, true)}>Descartar e {pendingOpen === "new" ? "criar novo" : "abrir outro"}</button></div></div>}
        {conflict && <div className="quote-warning" role="alert"><strong>Este pedido mudou em outra sessão.</strong><p>Suas alterações foram mantidas neste formulário. Confira a versão salva antes de escolher como continuar.</p>{conflict.request && <><p>Versão salva: <strong>{conflict.request.clientName}</strong> · revisão {conflict.request.revision} · {formatQuoteAmount(conflict.request.amountCents)} · {formatQuoteDate(conflict.request.updatedAt, true)}.</p><details><summary>Conferir dados da versão salva</summary><QuoteSnapshot record={conflict.request} /></details><div className="quote-inline-actions"><button type="button" className="button" onClick={() => { setDraft(editDraft(conflict.request!)); setConflict(null); }}>Usar a versão salva</button><button type="button" className="button dark" onClick={() => { const saved = conflict.request!; setDraft(current => ({ ...current, id: saved.id, baseRevision: saved.revision, createdAt: saved.createdAt, mutationId: uid(), dirty: true })); setConflict(null); setFormError(""); }}>Manter minhas alterações para revisar e salvar</button></div></>}{!conflict.request && <button type="button" className="button" onClick={() => { setDraft(current => ({ ...current, id: uid(), baseRevision: null, createdAt: null, mutationId: uid(), dirty: true })); setConflict(null); }}>Continuar como novo pedido</button>}</div>}
        <form onSubmit={event => { void save(event); }}>
          <fieldset disabled={disabled}>
            <legend className="quote-sr-only">Dados do pedido de orçamento</legend>
            <div className="quote-field-grid"><label className="quote-field-full">Nome do cliente <span aria-hidden="true">*</span><input name="clientName" autoComplete="off" maxLength={120} required value={draft.fields.clientName} placeholder="Quem solicitou o orçamento?" onChange={event => change({ clientName: event.target.value })} /></label><label>Contato <small>opcional</small><input name="contact" autoComplete="off" maxLength={120} value={draft.fields.contact} placeholder="Telefone, WhatsApp ou e-mail" onChange={event => change({ contact: event.target.value })} /></label><label>Data da solicitação <span aria-hidden="true">*</span><input type="date" name="requestedOn" required value={draft.fields.requestedOn} onChange={event => change({ requestedOn: event.target.value })} /></label></div>
            <div className="quote-items-head"><div><span className="section-kicker">O QUE O CLIENTE PRECISA</span><h3>Itens e medidas</h3></div><span>{draft.fields.items.length}/{QUOTE_ITEM_LIMIT}</span></div>
            <p className="quote-field-help">Altura, largura e medidas são opcionais. Preencha o que já sabe e indique a unidade se necessário: m, cm ou mm.</p>
            <div className="quote-form-items">{draft.fields.items.map((item, index) => <div className="quote-form-item" key={item.id}><div className="quote-item-head"><strong>Item {String(index + 1).padStart(2, "0")}</strong><button type="button" aria-label={`Remover item ${index + 1}`} disabled={draft.fields.items.length === 1} onClick={() => change({ items: draft.fields.items.filter(saved => saved.id !== item.id) })}>Remover</button></div><label>Produto / descrição <span aria-hidden="true">*</span><textarea rows={2} maxLength={500} required value={item.description} placeholder="Ex.: Porta integrada de 2 folhas" onChange={event => changeItem(item.id, { description: event.target.value })} /></label><div className="quote-item-dimensions"><label>Altura <small>opcional</small><input name="height" maxLength={80} value={item.height ?? ""} placeholder="Ex.: 2,30 m" onChange={event => changeItem(item.id, { height: event.target.value })} /></label><label>Largura <small>opcional</small><input name="width" maxLength={80} value={item.width ?? ""} placeholder="Ex.: 2,00 m" onChange={event => changeItem(item.id, { width: event.target.value })} /></label></div><div className="quote-item-measures"><label>Medidas <small>opcional</small><input name="measurements" maxLength={240} value={item.measurements} placeholder="Ex.: 2,30 A × 2,00 L" onChange={event => changeItem(item.id, { measurements: event.target.value })} /></label><label>Quantidade<input type="number" inputMode="numeric" min={1} max={10000} step={1} required value={Number.isNaN(item.quantity) ? "" : item.quantity} onChange={event => changeItem(item.id, { quantity: event.target.value === "" ? NaN : Number(event.target.value) })} /></label></div><label>Cor, vidro e outros detalhes<textarea rows={2} maxLength={800} value={item.details} placeholder="Ex.: Preto | Vidro temperado | Lado de abertura" onChange={event => changeItem(item.id, { details: event.target.value })} /></label></div>)}</div>
            <button className="button quote-add-item" type="button" disabled={draft.fields.items.length >= QUOTE_ITEM_LIMIT} onClick={() => change({ items: [...draft.fields.items, newItem()] })}>+ Adicionar outro item</button>
            <div className="quote-value-box"><label htmlFor="quote-amount">Valor total do orçamento <small>opcional</small></label><div className="quote-currency-input"><span aria-hidden="true">R$</span><input id="quote-amount" name="amount" type="text" inputMode="decimal" maxLength={40} placeholder="Ex.: 1.250,50" value={draft.amountText} onChange={event => { setDraft(current => ({ ...current, amountText: event.target.value, mutationId: uid(), dirty: true })); setFormError(""); }} /></div><p>Preencha quando tiver o valor. Deixe em branco se ainda estiver aguardando. Você pode atualizar depois.</p></div>
            <label className="quote-notes">Observações <small>opcional</small><textarea maxLength={8000} rows={3} value={draft.fields.notes} placeholder="Informações da obra, preferências e próximos passos…" onChange={event => change({ notes: event.target.value })} /></label>
            <label className="quote-sent-check"><input type="checkbox" checked={draft.fields.sent} onChange={event => change({ sent: event.target.checked })} /><span><strong>Já enviei este orçamento ao cliente</strong><small>Marque somente depois do envio. Essa opção registra o status.</small></span></label>
          </fieldset>
          {formError && <div className="quote-error" role="alert">{formError}</div>}
          {storageError && <p className="quote-warning" role="alert">Não foi possível guardar o rascunho neste aparelho. Mantenha esta página aberta até salvar o pedido.</p>}
          <div className="quote-save-row"><button type="submit" className="button dark" disabled={disabled || conflict !== null}>{saving ? "Salvando pedido…" : draft.baseRevision === null ? "Salvar pedido" : "Salvar alterações"}</button><span>{draft.dirty ? "Alterações ainda não salvas na conta" : draft.baseRevision === null ? "Preencha os campos com *" : "Pedido salvo na conta"}</span></div>
          <p className="quote-form-note">O histórico guarda os dados de cada versão, inclusive valores, medidas e status de envio. Um rascunho só fica neste aparelho até ser salvo.</p>
        </form>
      </section>
    </div>
    {history && <section className="quote-history" aria-labelledby="quote-history-title"><div className="quote-history-heading"><div><span className="section-kicker">CADA ALTERAÇÃO FICA REGISTRADA</span><h2 id="quote-history-title" tabIndex={-1} ref={historyHeading}>Histórico de {history.request.clientName}</h2><p>Criado em {formatQuoteDate(history.request.createdAt, true)} · {history.request.revision} {history.request.revision === 1 ? "versão" : "versões"} registradas</p></div><button className="button" type="button" onClick={() => { ++historyGeneration.current; setHistory(null); setHistoryLoading(false); }}>Fechar histórico</button></div>{historyError && <div className="quote-error" role="alert"><p>{historyError}</p><button type="button" className="button" onClick={() => { void loadHistory(history.request); }}>Tentar novamente</button></div>}<div className="quote-versions">{history.versions.map(version => <details key={version.revision}><summary><span className="quote-version-index">{String(version.revision).padStart(2, "0")}</span><span><strong>{actions[version.action] ?? "Pedido atualizado"}</strong><small>{formatQuoteDate(version.changedAt, true)}</small></span><span className="quote-version-amount">{formatQuoteAmount(version.snapshot.amountCents)}</span><span aria-hidden="true">+</span></summary><QuoteSnapshot record={version.snapshot} /></details>)}</div>{historyLoading && <p className="quote-loading" role="status">Carregando alterações…</p>}{history.nextBefore && <button type="button" className="button quote-load-more" disabled={historyLoading} onClick={() => { void loadHistory(history.request, history.nextBefore!); }}>Carregar alterações anteriores</button>}</section>}
  </div>;
}

function QuoteSnapshot({ record }: { record: QuoteRequestRecord }) {
  return <div className="quote-snapshot"><dl><div><dt>Cliente</dt><dd>{record.clientName}</dd></div><div><dt>Contato</dt><dd>{record.contact || "Não informado"}</dd></div><div><dt>Solicitado em</dt><dd>{formatQuoteDate(record.requestedOn)}</dd></div><div><dt>Valor total</dt><dd>{formatQuoteAmount(record.amountCents)}</dd></div><div><dt>Envio ao cliente</dt><dd>{record.sent ? `Enviado${record.sentAt ? ` · ${formatQuoteDate(record.sentAt, true)}` : ""}` : "Não enviado"}</dd></div><div><dt>Arquivo</dt><dd>{record.archivedAt ? `Arquivado em ${formatQuoteDate(record.archivedAt, true)}` : "Em andamento"}</dd></div></dl><ol>{record.items.map(item => <li key={item.id}><strong>{item.quantity} × {item.description}</strong>{item.height && <p>Altura: {item.height}</p>}{item.width && <p>Largura: {item.width}</p>}{item.measurements && <p>Medidas: {item.measurements}</p>}{item.details && <p>{item.details}</p>}</li>)}</ol>{record.notes && <div><strong>Observações</strong><p>{record.notes}</p></div>}</div>;
}
