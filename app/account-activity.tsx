"use client";

import { useEffect, useRef, useState } from "react";

type Request = (path: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;
type Activity = { id: string; changedAt: string; actorRole: string; kind: string; action: string; title: string; changedFields: string[]; beforeData?: unknown; afterData?: unknown };
type Day = { day: string; capturedAt: string; quoteCount: number; closed: boolean };
type Snapshot = Day & { profile: Record<string, unknown>; state: Record<string, unknown> | null; clientState: unknown };
const fieldNames: Record<string, string> = { marketingDaily: "Marketing diário", followups: "Controle de clientes", metrics: "Indicadores e valores", training: "Treinamento", factory: "Pedidos de fábrica", checks: "Checklist", sales: "Roteiro de vendas", timing: "Etapas do atendimento", messages: "Mensagens", brands: "Catálogos e aprendizado", resume: "Ponto de continuação", drawerChecks: "Conferência de materiais", displayName: "Nome", username: "Usuário", branch: "Filial", accessChanged: "Acesso atualizado", clientName: "Cliente", contact: "Telefone", items: "Itens, medidas e valores", sent: "Envio ao cliente", archivedAt: "Arquivamento", notes: "Observações", requestedOn: "Data solicitada", amountCents: "Valor" };
const actions: Record<string, string> = { created: "Criado", updated: "Atualizado", saved: "Salvo", sent: "Enviado e arquivado", unsent: "Envio desmarcado", archived: "Arquivado", restored: "Restaurado", removed: "Removido" };
function date(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value)); }
function dayLabel(value: string) { return value.split("-").reverse().join("/"); }
async function json<T>(response: Response): Promise<T> {
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Não foi possível consultar os registros.");
  return payload;
}

export function AccountActivity({ userId, request }: { userId: number; request: Request }) {
  const [tab, setTab] = useState<"activity" | "daily">("activity");
  const [events, setEvents] = useState<Activity[]>([]);
  const [days, setDays] = useState<Day[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [before, setBefore] = useState<string | null>(null);
  const [event, setEvent] = useState<Activity | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const pagedEvents = useRef(false);
  const pagedDays = useRef(false);
  const controllers = useRef(new Set<AbortController>());
  const base = `/api/admin/users/${userId}`;

  useEffect(() => {
    let running = false;
    const controller = new AbortController();
    const currentControllers = controllers.current;
    currentControllers.add(controller);
    const refresh = async () => {
      if (running || document.visibilityState === "hidden") return;
      running = true;
      try {
        const results = await Promise.allSettled([
          request(`${base}/activity`, { cache: "no-store", signal: controller.signal }).then(json<{ events: Activity[]; nextCursor: string | null }>),
          request(`${base}/daily`, { cache: "no-store", signal: controller.signal }).then(json<{ days: Day[]; nextBefore: string | null }>),
        ]);
        if (controller.signal.aborted) return;
        let failure = "";
        for (const [index, result] of results.entries()) {
          if (result.status === "rejected") { failure = result.reason instanceof Error ? result.reason.message : "Não foi possível atualizar o histórico."; continue; }
          if (index === 0) {
            const payload = result.value as { events: Activity[]; nextCursor: string | null };
            setEvents(previous => [...new Map([...previous, ...payload.events].map(item => [item.id, item])).values()].sort((a, b) => b.changedAt.localeCompare(a.changedAt) || b.id.localeCompare(a.id)));
            if (!pagedEvents.current) setCursor(payload.nextCursor);
          } else {
            const payload = result.value as { days: Day[]; nextBefore: string | null };
            setDays(previous => [...new Map([...previous, ...payload.days].map(item => [item.day, item])).values()].sort((a, b) => b.day.localeCompare(a.day)));
            if (!pagedDays.current) setBefore(payload.nextBefore);
          }
        }
        setError(failure);
        if (!failure) setCheckedAt(new Date().toISOString());
      } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Falha na atualização."); }
      finally { running = false; }
    };
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    const visible = () => { void refresh(); };
    window.addEventListener("focus", visible);
    window.addEventListener("online", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearTimeout(initial); window.clearInterval(timer);
      window.removeEventListener("focus", visible); window.removeEventListener("online", visible); document.removeEventListener("visibilitychange", visible);
      for (const current of currentControllers) current.abort();
      currentControllers.clear();
    };
  }, [base, request]);

  async function action(work: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const controller = new AbortController();
    controllers.current.add(controller);
    setBusy(true); setError("");
    try { await work(controller.signal); }
    catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Não foi possível abrir o registro."); }
    finally { controllers.current.delete(controller); if (!controller.signal.aborted) setBusy(false); }
  }

  async function download(day: Day, signal: AbortSignal) {
    const result = await json<{ snapshot: Snapshot }>(await request(`${base}/daily/${day.day}`, { signal, cache: "no-store" }));
    const quotes: unknown[] = [];
    let after = "";
    while (!signal.aborted) {
      const page = await json<{ quotes: { id: string; snapshot: unknown }[] }>(await request(`${base}/daily/${day.day}/quotes?capturedAt=${encodeURIComponent(result.snapshot.capturedAt)}${after ? `&after=${after}` : ""}`, { signal, cache: "no-store" }));
      if (signal.aborted) return;
      quotes.push(...page.quotes.map(item => item.snapshot));
      if (page.quotes.length < 10) break;
      const next = page.quotes.at(-1)?.id ?? "";
      if (next <= after) throw new Error("A lista de pedidos não avançou. Tente novamente.");
      after = next;
    }
    if (signal.aborted) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...result.snapshot, quoteRequests: quotes }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `fechamento-${userId}-${day.day}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="account-activity" aria-label="Atividade e fechamentos do funcionário">
    <div className="account-activity-heading"><div><h3>Histórico e fechamento diário</h3><p>Horário de Brasília · {checkedAt ? `Conferido em ${date(checkedAt)}` : "Consultando registros…"}</p></div></div>
    <div className="account-activity-tabs" role="tablist" aria-label="Tipo de registro">
      <button type="button" role="tab" aria-selected={tab === "activity"} onClick={() => setTab("activity")}>Alterações</button>
      <button type="button" role="tab" aria-selected={tab === "daily"} onClick={() => setTab("daily")}>Fechamentos diários</button>
    </div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    {tab === "activity" ? <div role="tabpanel" aria-label="Alterações">
      <p className="account-activity-help">Cada gravação fica registrada com data e origem. O histórico começa com esta atualização.</p>
      {!events.length && <p className="account-empty">Nenhuma alteração registrada desde a atualização.</p>}
      <ol className="account-activity-list">{events.map(item => <li key={item.id}>
        <div><strong>{item.title}</strong><span>{date(item.changedAt)} · {item.actorRole === "user" ? "Funcionário" : item.actorRole === "admin" ? "Painel administrativo" : "Sistema"} · {actions[item.action] ?? item.action}</span><small>{item.changedFields.filter(key => !["revision", "updatedAt", "createdAt"].includes(key)).map(key => fieldNames[key] ?? key).join(" · ")}</small></div>
        <button className="text-button" type="button" disabled={busy} onClick={() => void action(async signal => { const result = await json<{ event: Activity }>(await request(`${base}/activity/${item.id}`, { signal, cache: "no-store" })); if (!signal.aborted) setEvent(result.event); })}>Ver alteração</button>
      </li>)}</ol>
      {cursor && <button className="button ghost" type="button" disabled={busy} onClick={() => void action(async signal => {
        const result = await json<{ events: Activity[]; nextCursor: string | null }>(await request(`${base}/activity?cursor=${encodeURIComponent(cursor)}`, { signal, cache: "no-store" }));
        if (signal.aborted) return;
        pagedEvents.current = true; setEvents(previous => [...new Map([...previous, ...result.events].map(item => [item.id, item])).values()]); setCursor(result.nextCursor);
      })}>Carregar alterações anteriores</button>}
      {event && <div className="account-activity-record"><div className="account-detail-head"><h4>{event.title}</h4><button className="text-button" type="button" onClick={() => setEvent(null)}>Fechar registro</button></div><p>{date(event.changedAt)}</p><div className="account-change-values"><div><strong>Antes</strong><pre>{JSON.stringify(event.beforeData, null, 2)}</pre></div><div><strong>Depois</strong><pre>{JSON.stringify(event.afterData, null, 2)}</pre></div></div></div>}
    </div> : <div role="tabpanel" aria-label="Fechamentos diários">
      <p className="account-activity-help">A cópia local é preservada em cada aparelho. Os dados recebidos ficam reunidos por dia; na virada do dia, a última cópia sincronizada vira o fechamento. O dia atual continua em atualização.</p>
      {!days.length && <p className="account-empty">O primeiro fechamento aparecerá após o próximo uso ou salvamento desta conta.</p>}
      <ol className="account-activity-list">{days.map(day => <li key={day.day}><div><strong>{dayLabel(day.day)} <em>{day.closed ? "Fechado" : "Em andamento"}</em></strong><span>Última sincronização: {date(day.capturedAt)}</span><small>{day.quoteCount} pedidos de orçamento preservados</small></div><div className="account-daily-actions"><button className="text-button" type="button" disabled={busy} onClick={() => void action(async signal => { const result = await json<{ snapshot: Snapshot }>(await request(`${base}/daily/${day.day}`, { signal, cache: "no-store" })); if (!signal.aborted) setSnapshot(result.snapshot); })}>Ver fechamento</button><button className="text-button" type="button" disabled={busy} onClick={() => void action(signal => download(day, signal))}>{busy ? "Aguarde…" : "Baixar cópia"}</button></div></li>)}</ol>
      {before && <button className="button ghost" type="button" disabled={busy} onClick={() => void action(async signal => {
        const result = await json<{ days: Day[]; nextBefore: string | null }>(await request(`${base}/daily?before=${before}`, { signal, cache: "no-store" }));
        if (signal.aborted) return;
        pagedDays.current = true; setDays(previous => [...new Map([...previous, ...result.days].map(item => [item.day, item])).values()]); setBefore(result.nextBefore);
      })}>Carregar dias anteriores</button>}
      {snapshot && <div className="account-activity-record"><div className="account-detail-head"><h4>Fechamento de {dayLabel(snapshot.day)}</h4><button className="text-button" type="button" onClick={() => setSnapshot(null)}>Fechar registro</button></div><p>Recebido em {date(snapshot.capturedAt)} · {snapshot.quoteCount} pedidos</p><details><summary>Marketing diário</summary><pre>{JSON.stringify(snapshot.state?.marketingDaily ?? {}, null, 2)}</pre></details><details><summary>Todos os dados e progresso preservados</summary><pre>{JSON.stringify({ state: snapshot.state, clientState: snapshot.clientState }, null, 2)}</pre></details></div>}
    </div>}
  </section>;
}
