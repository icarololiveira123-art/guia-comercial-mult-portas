"use client";

import { FormEvent, useEffect, useId, useRef, useState } from "react";
import { followUpStatusOptions, prepareFollowUpEdit } from "./lib/followup-edit.mjs";
import { formatQuoteAmount, quoteAmountInput } from "./lib/quote-amount.mjs";

type FollowUpValues = NonNullable<ReturnType<typeof prepareFollowUpEdit>["values"]>;
type FollowUpRecord = FollowUpValues & { id: string };
type FollowUpDraft = Omit<FollowUpValues, "amountCents"> & { amount: string };

function editDraft(item: FollowUpRecord): FollowUpDraft {
  return { client: item.client, next: item.next, status: item.status, priority: item.priority, amount: quoteAmountInput(item.amountCents), done: item.done };
}

type FollowUpRowProps = {
  item: FollowUpRecord;
  onSave: (values: FollowUpValues) => void;
  onToggleDone: () => void;
  onDelete: () => void;
};

export function FollowUpRow({ item, onSave, onToggleDone, onDelete }: FollowUpRowProps) {
  const fieldId = useId();
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => editDraft(item));
  const [validation, setValidation] = useState({ error: "", field: null as string | null });

  useEffect(() => {
    if (!editing && wasEditing.current) editButton.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  function updateDraft<K extends keyof FollowUpDraft>(field: K, value: FollowUpDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
    setValidation({ error: "", field: null });
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = prepareFollowUpEdit(draft);
    if (!result.values) {
      setValidation({ error: result.error, field: result.field });
      return;
    }
    onSave(result.values);
    setEditing(false);
    setValidation({ error: "", field: null });
  }

  const errorId = fieldId + "-error";
  const validationProps = (field: string) => ({
    "aria-invalid": validation.field === field,
    "aria-describedby": validation.field === field ? errorId : undefined,
  });

  return (
    <article className={"followup-row" + (editing ? " is-editing" : item.done ? " completed" : "")}>
      {editing ? (
        <form className="followup-edit-form" onSubmit={save} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setEditing(false); } }} aria-label={"Editar registro de " + item.client}>
          <div className="followup-edit-heading"><span>EDITAR REGISTRO</span><strong>{item.client}</strong></div>
          <div className="followup-edit-fields">
            <label htmlFor={fieldId + "-client"}>Cliente / orçamento
              <input id={fieldId + "-client"} value={draft.client} onChange={(event) => updateDraft("client", event.target.value)} maxLength={160} required autoFocus {...validationProps("client")} />
            </label>
            <label htmlFor={fieldId + "-status"}>Status
              <select id={fieldId + "-status"} value={draft.status} onChange={(event) => updateDraft("status", event.target.value)} {...validationProps("status")}>
                {followUpStatusOptions.map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label htmlFor={fieldId + "-next"} className="followup-edit-wide">Próxima ação
              <textarea id={fieldId + "-next"} rows={2} value={draft.next} onChange={(event) => updateDraft("next", event.target.value)} maxLength={240} required {...validationProps("next")} />
            </label>
            <label htmlFor={fieldId + "-priority"}>Prioridade
              <select id={fieldId + "-priority"} value={draft.priority} onChange={(event) => updateDraft("priority", event.target.value as FollowUpValues["priority"])} {...validationProps("priority")}>
                <option>Alta</option><option>Média</option><option>Baixa</option>
              </select>
            </label>
            <label htmlFor={fieldId + "-amount"}>Valor do orçamento (R$) <small>opcional</small>
              <input id={fieldId + "-amount"} type="text" inputMode="decimal" maxLength={40} value={draft.amount} onChange={(event) => updateDraft("amount", event.target.value)} placeholder="Ex.: 1.250,50" {...validationProps("amount")} />
              <small>Deixe em branco se ainda não tiver um valor.</small>
            </label>
          </div>
          <label className="followup-edit-done"><input type="checkbox" checked={draft.done} onChange={(event) => updateDraft("done", event.target.checked)} /> Pendência concluída</label>
          {validation.error && <p id={errorId} className="quote-amount-error" role="alert">{validation.error}</p>}
          <div className="followup-edit-actions"><button type="submit" className="button dark">Salvar alterações</button><button type="button" className="button ghost" onClick={() => setEditing(false)}>Cancelar</button></div>
        </form>
      ) : (
        <>
          <button type="button" className={"row-check" + (item.done ? " checked" : "")} aria-label={(item.done ? "Reabrir pendência de " : "Concluir pendência de ") + item.client} onClick={onToggleDone}>{item.done ? "✓" : ""}</button>
          <div className="follow-main"><strong>{item.client}</strong><span>{item.status}</span><div className="quote-amount-display"><small>Valor do orçamento</small><b>{formatQuoteAmount(item.amountCents)}</b></div><button ref={editButton} type="button" className="followup-edit-button" aria-label={"Editar registro de " + item.client} onClick={() => { setDraft(editDraft(item)); setValidation({ error: "", field: null }); setEditing(true); }}>Editar registro</button></div>
          <div className="follow-next"><small>Próxima ação</small><p>{item.next}</p></div>
          <span className={"priority-badge " + item.priority.toLowerCase().replace("é", "e")}>{item.priority}</span>
          <button type="button" className="delete-row" aria-label={"Excluir pendência de " + item.client} onClick={onDelete}>×</button>
        </>
      )}
    </article>
  );
}
