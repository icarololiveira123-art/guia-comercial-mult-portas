import { parseQuoteAmount, QUOTE_AMOUNT_ERROR } from "./quote-amount.mjs";

export const followUpStatusOptions = [
  "A confirmar", "Aguardando medidas", "Aguardando decisão", "Aguardando retorno",
  "Negociação ativa", "Transferido", "Venda fechada", "Não vai fechar agora", "Encerrado",
];

/** @typedef {{ client: string, next: string, status: string, priority: "Alta" | "Média" | "Baixa", amountCents: number | null, done: boolean }} FollowUpValues */

/** Validate a complete edit without accepting a replacement record ID.
 * @param {Record<string, unknown>} draft
 * @returns {{ values: FollowUpValues | null, error: string, field: string | null }}
 */
export function prepareFollowUpEdit(draft) {
  const client = typeof draft.client === "string" ? draft.client.trim() : "";
  const next = typeof draft.next === "string" ? draft.next.trim() : "";
  if (!client || client.length > 160) return { values: null, field: "client", error: "Informe o cliente ou orçamento com até 160 caracteres." };
  if (!next || next.length > 240) return { values: null, field: "next", error: "Informe a próxima ação com até 240 caracteres." };
  if (typeof draft.status !== "string" || !followUpStatusOptions.includes(draft.status)) return { values: null, field: "status", error: "Selecione um status válido." };
  if (draft.priority !== "Alta" && draft.priority !== "Média" && draft.priority !== "Baixa") return { values: null, field: "priority", error: "Selecione uma prioridade válida." };
  const amount = parseQuoteAmount(draft.amount);
  if (!amount.valid) return { values: null, field: "amount", error: QUOTE_AMOUNT_ERROR };
  return { values: { client, next, status: draft.status, priority: draft.priority, amountCents: amount.amountCents, done: draft.done === true }, error: "", field: null };
}
