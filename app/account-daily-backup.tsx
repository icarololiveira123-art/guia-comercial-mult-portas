"use client";

import { useEffect, useRef, useState } from "react";
import { businessDay } from "./lib/local-workspace-archive.mjs";

type Request = (path: string, init?: RequestInit) => Promise<Response>;
type BackupAccount = { userId: number; profile: { displayName: string }; capturedAt: string };
async function read(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Não foi possível consultar o backup.");
  return result;
}
export function AccountDailyBackup({ request }: { request: Request }) {
  const [day, setDay] = useState(() => businessDay());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [accounts, setAccounts] = useState<BackupAccount[]>([]);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => () => controllerRef.current?.abort(), []);
  async function download(account?: BackupAccount) {
    if (busy) return;
    const controller = new AbortController(); controllerRef.current = controller;
    const init = { signal: controller.signal, cache: "no-store" as const };
    setBusy(true); setError(""); setStatus("Consultando as cópias individuais na nuvem…");
    try {
      if (!account) {
        const index = await read(await request(`/api/admin/daily?day=${day}`, init));
        if (controller.signal.aborted) return;
        setAccounts(index.accounts);
        setStatus(index.accounts.length ? `${index.accounts.length} perfil(s) com cópia nesta data. Escolha o perfil abaixo.` : "Nenhum dado recebido nesta data. As cópias dos outros dias continuam guardadas.");
        return;
      }
        setStatus(`Preparando a cópia de ${account.profile.displayName}…`);
        const base = `/api/admin/users/${account.userId}/daily/${day}`;
        const result = await read(await request(base, init));
        const quotes: unknown[] = [];
        let after = "";
        while (!controller.signal.aborted) {
          const page = await read(await request(`${base}/quotes?capturedAt=${encodeURIComponent(result.snapshot.capturedAt)}${after ? `&after=${after}` : ""}`, init));
          quotes.push(...page.quotes.map((item: { snapshot: unknown }) => item.snapshot));
          if (page.quotes.length < 10) break;
          const next = page.quotes.at(-1).id as string;
          if (next <= after) throw new Error("A lista de pedidos não avançou. Tente novamente.");
          after = next;
        }
        if (controller.signal.aborted) return;
      const backup = { format: "mult-portas-profile-backup-v1", day, timeZone: "America/Sao_Paulo", exportedAt: new Date().toISOString(), ...result.snapshot, quoteRequests: quotes };
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `backup-perfil-${account.userId}-${day}.json`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`Cópia de ${account.profile.displayName} preparada. O backup individual continua guardado na nuvem.`);
    } catch (caught) { if (!controller.signal.aborted) { setError(caught instanceof Error ? caught.message : "Não foi possível baixar o backup."); setStatus(""); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className="account-cloud-backup" aria-label="Backups individuais na nuvem">
    <div><span className="section-kicker">BACKUP POR PERFIL</span><h2>Cada pessoa, com sua própria cópia.</h2><p>Dados, progresso e pedidos preservados na nuvem por usuário e data. Cada arquivo contém somente o perfil escolhido.</p></div>
    <div className="account-backup-controls"><label><span>Data do backup</span><input type="date" value={day} max={businessDay()} disabled={busy} onChange={event => { setDay(event.target.value); setAccounts([]); setStatus(""); setError(""); }} /></label><button className="button primary" type="button" disabled={busy || !day} onClick={() => void download()}>{busy ? "Consultando…" : "Consultar perfis nesta data"}</button></div>
    {accounts.length > 0 && <ul className="account-backup-profiles">{accounts.map(account => <li key={account.userId}><strong>{account.profile.displayName}</strong><button className="text-button" type="button" disabled={busy} onClick={() => void download(account)}>Baixar cópia deste perfil</button></li>)}</ul>}
    {status && <p role="status">{status}</p>}{error && <p className="auth-error" role="alert">{error}</p>}
  </section>;
}
