export const CUSTOMER_ROLE_CONTRACT = [
  "customerReply contém somente a próxima fala do cliente, em primeira pessoa e em português natural do Brasil.",
  "O cliente responde ao que o vendedor perguntou antes de levantar uma nova dúvida.",
  "O cliente não ensina vendas, não avalia o vendedor e não descreve a próxima ação comercial.",
  "O cliente não promete separar opções, medir, montar proposta, conferir estoque, registrar retorno ou enviar catálogo.",
  "A fala tem no máximo duas frases curtas e deve soar como uma mensagem espontânea, não como roteiro corporativo.",
].join(" ");

export const CUSTOMER_ROLE_LEAK_PATTERNS = [
  /como vendedor|como treinador|sou seu treinador|avaliação do vendedor/i,
  /sua resposta|você acertou|você (?:precisa (?:melhorar|perguntar|fazer|ajustar|conduzir)|deve)|tente perguntar|melhore|rubrica|pontua(?:ção|r)/i,
  /próxima ação comercial|próximo passo para o vendedor|faça (?:uma|a) pergunta|diagnóstico antes/i,
  /para eu não te mandar op(?:ç|c)(?:ão|ões) demais/i,
  /(?:vou|posso|consigo) (?:te )?(?:registrar|conferir|montar|separar|verificar|mostrar|enviar|apresentar)\b/i,
  /(?:primeiro )?separo o que está incluso|posso verificar a condição/i,
  /não vou te prometer uma data|a foto ajuda a visualizar, mas não substitui a trena/i,
  /organize a lista com ambiente|consigo estudar uma condição de volume/i,
  /não vou instalar ainda\. me envie|posso te mandar o catálogo|te envio as opções certas/i,
  /o kit é pensado para|a proposta do kit é/i,
  /^(?:cliente|vendedor|treinador|avaliação|feedback|próxima ação)\s*:/i,
];

const FALLBACKS = {
  "price-first": "Ainda estou pesquisando e o valor pesa para mim. O que você precisa saber do ambiente para me indicar algo sem fugir do que eu procuro?",
  "measure-gap": "Eu ainda confundo a medida da folha com a do vão. Você pode me dizer exatamente o que preciso medir?",
  "price-objection": "Eu ainda quero entender por que a outra opção ficou mais barata. O que preciso comparar nas duas propostas?",
  timeline: "A obra ainda está em andamento e eu não quero decidir cedo demais. Quando você recomenda que eu volte a falar com vocês?",
  "complex-decision": "A entrada é a parte mais importante, mas também preciso resolver os quartos. Como podemos organizar as opções sem misturar tudo?",
  "pix-discount": "Quero comparar o valor à vista com o parcelado, mas ainda não sei se o conjunto é o mesmo. O que está incluído?",
  "photo-only": "Eu consigo mandar uma foto, mas ainda não tenho as medidas. Quais dados você precisa junto com a imagem?",
  "space-choice": "É para um ambiente pequeno e eu quero ganhar espaço. O que você precisa saber para comparar correr e camarão?",
  "catalog-request": "Pode me mostrar algumas opções para a entrada? Ainda estou em dúvida entre um estilo moderno e um mais clássico.",
  "volume-work": "Tenho vários vãos e algumas medidas repetidas. Posso te passar a lista por ambiente para comparar as opções?",
  "wood-aluminum": "Quero comparar madeira e alumínio, mas os ambientes são diferentes. Por onde você recomenda começar?",
  "silent-customer": "Eu ainda não decidi porque estou comparando o que vem em cada proposta. Você consegue resumir a principal diferença?",
  "after-sales": "A peça parece diferente do que eu esperava e ainda não foi instalada. Quais fotos e informações você precisa para conferir?",
  "installation-question": "Quero evitar muita sujeira na obra. O tipo de parede muda o que eu preciso escolher?",
  "finish-choice": "O ambiente é claro e tem móveis amadeirados. Você pode me mostrar uma opção discreta e outra mais marcante?",
  "wet-area": "A lavanderia é coberta, mas tem bastante umidade. O que muda entre madeira e alumínio nesse caso?",
  objection: "Entendi, mas ainda estou comparando. O que muda de verdade entre essas opções?",
};

export function customerReplyFallback(scenario) {
  const scenarioId = typeof scenario?.id === "string" ? scenario.id : "";
  return Object.hasOwn(FALLBACKS, scenarioId)
    ? FALLBACKS[scenarioId]
    : "Entendi. Ainda tenho alguns detalhes do ambiente para confirmar. O que você precisa saber primeiro?";
}

function normalizeReply(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(/^(?:cliente|vendedor|treinador|avaliação|feedback|próxima ação)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

export function isCustomerReplySafe(value) {
  const reply = normalizeReply(value);
  if (!reply || reply.length < 3) return false;
  return !CUSTOMER_ROLE_LEAK_PATTERNS.some((pattern) => pattern.test(reply));
}

export function sanitizeCustomerReply(value, scenario) {
  const reply = normalizeReply(value);
  return isCustomerReplySafe(reply) ? reply : customerReplyFallback(scenario);
}

export function guidedCustomerReply(scenario, signals) {
  const replies = Array.isArray(scenario?.customerReplies) ? scenario.customerReplies : [];
  const usefulSignals = [
    signals?.hasQuestion,
    signals?.hasEnvironment,
    signals?.hasMeasure,
    signals?.hasBenefit,
    signals?.hasNextMove,
    signals?.hasGuardrail,
    signals?.hasEmpathy,
  ].filter(Boolean).length;
  const heldBack = Boolean(signals?.hasPressure) || (Boolean(signals?.asksPrice) && usefulSignals < 2);
  // Repeating a weak message never unlocks a later customer reply merely
  // because another turn elapsed.
  const nextIndex = heldBack ? 0 : usefulSignals >= 4 ? 2 : usefulSignals >= 2 ? 1 : 0;
  const selected = replies[nextIndex];
  return isCustomerReplySafe(selected) ? selected : customerReplyFallback(scenario);
}
