"use client";

import { FormEvent, useId, useState } from "react";
import { formatQuoteAmount, parseQuoteAmount, quoteAmountInput, QUOTE_AMOUNT_ERROR } from "./lib/quote-amount.mjs";

type QuoteAmountEditorProps = {
  amountCents: number | null;
  client: string;
  onSave: (amountCents: number | null) => void;
};

export function QuoteAmountEditor({ amountCents, client, onSave }: QuoteAmountEditorProps) {
  const inputId = useId();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseQuoteAmount(draft);
    if (!parsed.valid) {
      setError(QUOTE_AMOUNT_ERROR);
      return;
    }
    onSave(parsed.amountCents);
    setEditing(false);
    setError("");
  }

  if (editing) {
    return (
      <form className="quote-amount-editor" onSubmit={save}>
        <label htmlFor={inputId}>Valor do orçamento (R$)</label>
        <input id={inputId} type="text" inputMode="decimal" autoFocus maxLength={40}
          value={draft} onChange={(event) => { setDraft(event.target.value); setError(""); }}
          placeholder="Ex.: 1.250,50" aria-label={"Valor do orçamento de " + client}
          aria-invalid={Boolean(error)} aria-describedby={inputId + "-help" + (error ? " " + inputId + "-error" : "")} />
        <small id={inputId + "-help"}>Deixe em branco para remover o valor.</small>
        {error && <p className="quote-amount-error" id={inputId + "-error"} role="alert">{error}</p>}
        <div className="quote-amount-actions">
          <button type="submit">Salvar valor</button>
          <button type="button" onClick={() => { setEditing(false); setError(""); }}>Cancelar</button>
        </div>
      </form>
    );
  }

  return (
    <div className="quote-amount-display">
      <small>Valor do orçamento</small>
      <b>{formatQuoteAmount(amountCents)}</b>
      <button type="button" aria-label={(amountCents === null ? "Informar valor do orçamento de " : "Editar valor do orçamento de ") + client}
        onClick={() => { setDraft(quoteAmountInput(amountCents)); setError(""); setEditing(true); }}>
        {amountCents === null ? "Informar valor" : "Editar valor"}
      </button>
    </div>
  );
}
