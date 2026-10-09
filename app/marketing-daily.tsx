"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { WorkspaceIcon } from "./workspace-icon";
import {
  buildMarketingReport, formatMarketingDate, getMarketingDay, marketingCounters,
  marketingDateKey, MAX_MARKETING_COUNT, resetMarketingDay, setMarketingCount,
  type MarketingCounter, type MarketingDailyState,
} from "./lib/marketing-daily.mjs";

type Props = {
  seller: string;
  state: MarketingDailyState;
  onChange: Dispatch<SetStateAction<MarketingDailyState>>;
};

export function MarketingDaily({ seller, state, onChange }: Props) {
  const [today, setToday] = useState(() => marketingDateKey());
  const [selectedDate, setSelectedDate] = useState("");
  const [confirmDate, setConfirmDate] = useState("");
  const [feedback, setFeedback] = useState("");
  const reportRef = useRef<HTMLTextAreaElement>(null);
  const date = selectedDate || today;
  const isToday = date === today;
  const day = getMarketingDay(state, date, seller);
  const history = state.days.filter((item) => item.date !== today);
  const report = buildMarketingReport(day);
  const hasCounts = marketingCounters.some(({ id }) => day[id] > 0);

  useEffect(() => {
    const refreshDate = () => setToday(marketingDateKey());
    const timer = window.setInterval(refreshDate, 30_000);
    window.addEventListener("focus", refreshDate);
    document.addEventListener("visibilitychange", refreshDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshDate);
      document.removeEventListener("visibilitychange", refreshDate);
    };
  }, []);

  function updateCount(field: MarketingCounter, value: string | number, delta = 0) {
    // Read the date at the moment of the click, including after a suspended tab.
    const currentDate = marketingDateKey();
    setToday(currentDate);
    setFeedback("");
    onChange((current) => setMarketingCount(current, currentDate, seller, field,
      delta ? getMarketingDay(current, currentDate, seller)[field] + delta : value));
  }

  function clearToday() {
    const currentDate = marketingDateKey();
    setToday(currentDate);
    setConfirmDate("");
    if (currentDate !== confirmDate) {
      setFeedback("O dia mudou. Os registros anteriores foram preservados e a lista de hoje começa zerada.");
      return;
    }
    onChange((current) => resetMarketingDay(current, currentDate, seller));
    setFeedback("Contadores de hoje zerados. O histórico dos outros dias foi mantido.");
  }

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(report);
      setFeedback("Resumo copiado. Cole na conversa do WhatsApp.");
    } catch {
      reportRef.current?.focus();
      reportRef.current?.select();
      setFeedback("Selecionei o resumo. Use a opção Copiar do seu aparelho.");
    }
  }

  return <div className="page-content marketing-page">
    <header className="marketing-heading">
      <div><span className="section-kicker">OPERAÇÃO / ROTINA DO DIA</span><h1>Marketing diário</h1><p>Registre os contatos e leve a listinha pronta para a equipe.</p></div>
      <div className="marketing-date"><WorkspaceIcon name="calendar" /><span>{isToday ? "HOJE" : "HISTÓRICO"}<strong>{formatMarketingDate(date)}</strong></span></div>
    </header>

    <div className="marketing-layout">
      <section className="marketing-board" aria-labelledby="marketing-counters-title">
        <div className="marketing-board-head"><div><span className="section-kicker">{isToday ? "SEU MOVIMENTO" : "DIA ENCERRADO"}</span><h2 id="marketing-counters-title">{isToday ? "Cada contato conta." : "Resumo do dia"}</h2></div><span className="marketing-seller"><WorkspaceIcon name="work" />{day.seller}</span></div>
        {!isToday && <div className="marketing-history-notice"><p>Você está consultando um dia anterior. Os contadores de hoje continuam separados.</p><button className="button dark" type="button" onClick={() => { setSelectedDate(""); setFeedback(""); }}>Voltar para hoje</button></div>}
        <div className="marketing-counters">
          {marketingCounters.map((counter, index) => <div className="marketing-counter" key={counter.id}>
            <div className="marketing-counter-copy"><span className="marketing-counter-index">0{index + 1}</span><div><label htmlFor={`marketing-${counter.id}`}>{counter.label}</label><p>{counter.description}</p></div></div>
            <div className="marketing-stepper">
              <button type="button" disabled={!isToday || day[counter.id] === 0} onClick={() => updateCount(counter.id, 0, -1)} aria-label={`Diminuir ${counter.label.toLocaleLowerCase("pt-BR")}`}>−</button>
              <input id={`marketing-${counter.id}`} aria-label={counter.label} type="number" inputMode="numeric" min="0" max={MAX_MARKETING_COUNT} step="1" value={day[counter.id]} readOnly={!isToday} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateCount(counter.id, event.target.value)} />
              <button className="marketing-plus" type="button" disabled={!isToday || day[counter.id] >= MAX_MARKETING_COUNT} onClick={() => updateCount(counter.id, 0, 1)} aria-label={`Aumentar ${counter.label.toLocaleLowerCase("pt-BR")}`}>+</button>
            </div>
          </div>)}
        </div>
        <div className="marketing-board-foot"><p>Use <strong>+ e −</strong> ou digite o número. Cada contador é independente, como na sua listinha.</p>{isToday && <button className="marketing-reset" type="button" disabled={!hasCounts} onClick={() => setConfirmDate(today)}>Zerar contadores de hoje</button>}</div>
        {isToday && confirmDate === today && <div className="marketing-reset-confirm" role="alert"><div><strong>Zerar a lista de {formatMarketingDate(today)}?</strong><p>Os cinco contadores de hoje voltam para zero. Os outros dias permanecem no histórico.</p></div><div><button className="button" type="button" onClick={() => setConfirmDate("")}>Cancelar</button><button className="button dark" type="button" onClick={clearToday}>Sim, zerar hoje</button></div></div>}
      </section>

      <aside className="marketing-summary" aria-labelledby="marketing-summary-title">
        <div><span className="section-kicker">PRONTO PARA COMPARTILHAR</span><h2 id="marketing-summary-title">Sua listinha,<br />sem retrabalho.</h2><p>O mesmo formato de todos os dias, atualizado a cada toque.</p></div>
        <div className="marketing-message"><span>{formatMarketingDate(date)}</span><textarea ref={reportRef} aria-label="Resumo do marketing diário" readOnly value={report} rows={8} spellCheck={false} /></div>
        <button className="button dark marketing-copy" type="button" onClick={() => { void copyReport(); }}>Copiar resumo <WorkspaceIcon name="message" /></button>
        <p className="marketing-feedback" role="status" aria-live="polite">{feedback}</p>
        <div className="marketing-next-day"><WorkspaceIcon name="calendar" /><p><strong>Amanhã começa do zero.</strong> O novo dia abre uma lista vazia e mantém o dia anterior no histórico. Horário de Brasília.</p></div>
      </aside>
    </div>

    <section className="marketing-history" aria-labelledby="marketing-history-title"><div className="marketing-history-head"><div><span className="section-kicker">SEUS DIAS ANTERIORES</span><h2 id="marketing-history-title">Histórico diário</h2></div><span>{history.length} {history.length === 1 ? "dia registrado" : "dias registrados"}</span></div>
      {history.length ? <details><summary>Consultar e copiar dias anteriores <span>+</span></summary><div className="marketing-history-list">{history.map((item) => <button key={item.date} type="button" aria-pressed={selectedDate === item.date} onClick={() => { setSelectedDate(item.date); setConfirmDate(""); setFeedback(""); }}><WorkspaceIcon name="calendar" /><span><strong>{formatMarketingDate(item.date)}</strong><small>{item.seller}</small></span><span><strong>{item.newContacts}</strong><small>contatos novos</small></span><WorkspaceIcon name="arrow" /></button>)}</div></details> : <p className="marketing-empty">Seu histórico aparece aqui a partir do próximo dia com registros. A lista de hoje é salva junto aos dados da sua conta.</p>}
      <p className="marketing-history-limit">Os últimos 366 dias registrados ficam disponíveis nesta conta.</p>
    </section>
  </div>;
}
