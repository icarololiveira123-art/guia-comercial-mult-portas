function cleanText(value, maxLength = 240) {
  if (typeof value !== "string") return "";
  const cleaned = value.trim().replace(/\s+/g, " ").slice(0, maxLength);
  return /^(undefined|null|nan)$/i.test(cleaned) ? "" : cleaned;
}

const fairDefaults = {
  eventName: "Feirão SUPER PROMO MULT PORTAS",
  eventDate: "sábado, 29/08",
  eventTime: "das 9h às 17h",
  city: "Araraquara",
  discount: "até 60% OFF",
};

export const fairClientProfiles = [
  { id: "neutral", label: "Neutro", shortLabel: "Neutro", description: "Convite versátil, sem presumir contato anterior." },
  { id: "quote", label: "Já pediu orçamento", shortLabel: "Orçamento", description: "Retoma a cotação com cuidado e sem cobrança." },
  { id: "store-visit", label: "Visitou a loja", shortLabel: "Visitou a loja", description: "Reconhece a visita e convida para comparar opções." },
  { id: "reengagement", label: "Contato sem resposta", shortLabel: "Retomada leve", description: "Reabre a conversa sem dizer que o cliente sumiu." },
  { id: "construction", label: "Em obra ou reforma", shortLabel: "Obra / reforma", description: "Conecta o Feirão ao momento do projeto." },
  { id: "price", label: "Focado em preço", shortLabel: "Foco em preço", description: "Valoriza a condição sem prometer o menor preço." },
  { id: "returning", label: "Cliente antigo", shortLabel: "Cliente antigo", description: "Retoma o relacionamento de forma próxima." },
];

export const fairToneOptions = [
  { id: "welcoming", label: "Acolhedor", description: "Recebe com carinho e deixa o cliente à vontade." },
  { id: "direct", label: "Direto", description: "Vai ao ponto sem perder a educação." },
  { id: "persuasive", label: "Persuasivo", description: "Mostra valor e facilita o próximo passo, sem pressão." },
];

export const fairInterestOptions = [
  "portas de aço",
  "portas de alumínio",
  "portas de madeira",
  "janelas",
  "itens para a obra",
  "opções do orçamento",
];

export const fairEmojiModes = [
  { id: "mixed", label: "Alternar", description: "O sorteio varia entre nenhum, poucos e mais emojis." },
  { id: "none", label: "Sem emojis", description: "Somente texto, com aparência mais sóbria." },
  { id: "light", label: "Leve", description: "Um emoji discreto por mensagem." },
  { id: "balanced", label: "Equilibrado", description: "Dois ou três emojis bem distribuídos." },
  { id: "expressive", label: "Mais emojis", description: "Quatro emojis acolhedores, sem exagero." },
];

export const FAIR_VARIATION_COUNT = 144;

function normalizeVariation(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return ((Math.trunc(numeric) % FAIR_VARIATION_COUNT) + FAIR_VARIATION_COUNT) % FAIR_VARIATION_COUNT;
}

function pickVariant(options, index) {
  return options[((index % options.length) + options.length) % options.length];
}

export function fairVariationRecipe(value) {
  const variation = normalizeVariation(value);
  const x = variation % 12;
  const y = Math.floor(variation / 12);
  return {
    greeting: x,
    context: y,
    event: (x + y) % 12,
    benefit: (x + (2 * y)) % 12,
    closing: (x + (3 * y)) % 12,
    structure: (x + (5 * y)) % 12,
    sender: (x + (7 * y)) % 12,
  };
}

export function nextFairVariation(currentVariation, randomValue = 0) {
  const current = normalizeVariation(currentVariation);
  const numericRandom = Number(randomValue);
  const safeRandom = Number.isFinite(numericRandom) ? Math.abs(Math.trunc(numericRandom)) : 0;
  const offset = (safeRandom % (FAIR_VARIATION_COUNT - 1)) + 1;
  return (current + offset) % FAIR_VARIATION_COUNT;
}

function greetingOptions(clientName) {
  return clientName ? [
    `Oi, ${clientName}! Tudo bem?`,
    `Olá, ${clientName}! Como você está?`,
    `Oi, ${clientName}! Espero que esteja tudo bem por aí.`,
    `Olá, ${clientName}! Passando para falar com você com calma.`,
    `Oi, ${clientName}! Lembrei de você hoje.`,
    `Olá, ${clientName}! Tenho uma informação que pode ser útil.`,
    `Oi, ${clientName}! Como estão as coisas por aí?`,
    `Olá, ${clientName}! Queria compartilhar um convite da Mult Portas.`,
    `Oi, ${clientName}! Separei este recado especialmente para você.`,
    `Olá, ${clientName}! Posso te fazer um convite rápido?`,
    `Oi, ${clientName}! Tudo certo? Vim deixar uma novidade.`,
    `Olá, ${clientName}! Espero encontrar você bem.`,
  ] : [
    "Oi! Tudo bem?",
    "Olá! Como você está?",
    "Oi! Espero que esteja tudo bem por aí.",
    "Olá! Passando para falar com você com calma.",
    "Oi! Passando com uma informação especial.",
    "Olá! Tenho uma informação que pode ser útil.",
    "Oi! Como estão as coisas por aí?",
    "Olá! Queria compartilhar um convite da Mult Portas.",
    "Oi! Separei um recado para você.",
    "Olá! Posso te fazer um convite rápido?",
    "Oi! Tudo certo? Vim deixar uma novidade.",
    "Olá! Espero encontrar você bem.",
  ];
}

function senderOptions(consultantName) {
  return consultantName ? [
    `Aqui é ${consultantName}, da Mult Portas.`,
    `Quem fala é ${consultantName}, da Mult Portas.`,
    `Sou ${consultantName}, do atendimento da Mult Portas.`,
    `${consultantName} aqui, da Mult Portas.`,
    `Meu nome é ${consultantName} e faço parte da equipe Mult Portas.`,
    `É ${consultantName} falando, do time da Mult Portas.`,
    `Estou falando pela Mult Portas; sou ${consultantName}.`,
    `Passando em nome da Mult Portas, aqui é ${consultantName}.`,
    `Aqui na Mult Portas, quem está falando é ${consultantName}.`,
    `Sou ${consultantName} e cuido do atendimento na Mult Portas.`,
    `Quem está entrando em contato é ${consultantName}, da Mult Portas.`,
    `Aqui é ${consultantName}, do time comercial da Mult Portas.`,
  ] : [
    "Aqui é da equipe da Mult Portas.",
    "Quem fala é a equipe da Mult Portas.",
    "Somos do atendimento da Mult Portas.",
    "Aqui é o pessoal da Mult Portas.",
    "Este contato é da equipe Mult Portas.",
    "É o time da Mult Portas falando.",
    "Estamos falando pela Mult Portas.",
    "Passando em nome da Mult Portas.",
    "Aqui na Mult Portas, somos da equipe de atendimento.",
    "Somos da equipe que cuida do atendimento na Mult Portas.",
    "Quem está entrando em contato é a equipe Mult Portas.",
    "Aqui é o time comercial da Mult Portas.",
  ];
}

function profileHookOptions(profileId, interest) {
  const product = interest ? interest.toLocaleLowerCase("pt-BR") : "";
  const ofProduct = product ? ` de ${product}` : "";
  const forProduct = product ? ` para ${product}` : "";

  switch (profileId) {
    case "quote":
      return [
        product ? `Lembrei do orçamento que preparamos${forProduct} e quis compartilhar este convite.` : "Lembrei do orçamento que preparamos e quis compartilhar este convite.",
        product ? `Como já conversamos sobre ${product}, achei válido avisar sobre uma nova oportunidade de comparar opções.` : "Como já conversamos sobre seu projeto, achei válido avisar sobre uma nova oportunidade de comparar opções.",
        product ? `Talvez você ainda esteja avaliando caminhos para ${product}; por isso, separei uma informação que pode ajudar.` : "Talvez você ainda esteja avaliando caminhos; por isso, separei uma informação que pode ajudar.",
        product ? `Sem saber se você já decidiu sobre ${product}, quis apenas deixar este convite à disposição.` : "Sem saber se você já decidiu, quis apenas deixar este convite à disposição.",
        product ? `Se o projeto continua nos seus planos com ${product}, temos uma programação que pode ser interessante.` : "Se o projeto continua nos seus planos, temos uma programação que pode ser interessante.",
        product ? `Depois do seu pedido de orçamento${ofProduct}, surgiu uma ocasião para rever alternativas com calma.` : "Depois do seu pedido de orçamento, surgiu uma ocasião para rever alternativas com calma.",
        product ? `Quis retomar nosso contato só para compartilhar uma novidade relacionada a ${product}, sem compromisso.` : "Quis retomar nosso contato só para compartilhar uma novidade, sem compromisso.",
        product ? `Como você já pesquisou valores conosco para ${product}, este evento pode ser útil para uma nova comparação.` : "Como você já pesquisou valores conosco, este evento pode ser útil para uma nova comparação.",
        product ? `Se o seu momento mudou, tudo bem; ainda assim, achei gentil avisar desta oportunidade para avaliar ${product}.` : "Se o seu momento mudou, tudo bem; ainda assim, achei gentil avisar desta oportunidade.",
        product ? `O orçamento foi um primeiro passo na pesquisa por ${product}, e este convite pode complementar essa busca.` : "O orçamento foi um primeiro passo na sua pesquisa, e este convite pode complementar essa busca.",
        product ? `Como você já demonstrou interesse em uma proposta sobre ${product}, quis contar sobre uma ação da Mult Portas.` : "Como você já demonstrou interesse em uma proposta, quis contar sobre uma ação da Mult Portas.",
        product ? `Se ainda estiver fazendo sua escolha sobre ${product}, deixo este convite aberto para conhecer outras possibilidades.` : "Se ainda estiver fazendo sua escolha, deixo este convite aberto para conhecer outras possibilidades.",
      ];
    case "store-visit":
      return [
        product ? `Foi muito bom receber você na Mult Portas para conhecer ${product}; quis compartilhar um novo convite.` : "Foi muito bom receber você na Mult Portas; quis compartilhar um novo convite.",
        product ? `Depois da sua visita para ver ${product}, achei que esta informação poderia ser útil.` : "Depois da sua visita, achei que esta informação poderia ser útil.",
        product ? `Como você já conheceu de perto algumas opções de ${product}, queria avisar sobre nossa programação.` : "Como você já conheceu de perto algumas opções, queria avisar sobre nossa programação.",
        product ? `Lembrei da nossa conversa na loja sobre ${product} e pensei em fazer este convite.` : "Lembrei da nossa conversa na loja e pensei em fazer este convite.",
        product ? `Talvez tenham ficado dúvidas depois da visita sobre ${product}; surgiu uma boa ocasião para conversar novamente.` : "Talvez tenham ficado dúvidas depois da visita; surgiu uma boa ocasião para conversar novamente.",
        product ? `Você já deu uma olhada na loja em ${product}, então quis compartilhar uma nova oportunidade de comparar.` : "Você já deu uma olhada na loja, então quis compartilhar uma nova oportunidade de comparar.",
        product ? `Quis complementar sua visita com uma informação sobre ${product} que pode ajudar na escolha.` : "Quis complementar sua visita com uma informação que pode ajudar na escolha.",
        product ? `Como você já passou por aqui em busca de ${product}, será muito bom receber você novamente.` : "Como você já passou por aqui, será muito bom receber você novamente.",
        product ? `Gostei de receber você na loja para conversar sobre ${product} e lembrei de avisar deste evento.` : "Gostei de receber você na loja e lembrei de avisar deste evento.",
        product ? `Quando soube da programação, lembrei da sua visita e do interesse em ${product}.` : "Quando soube da programação, lembrei da sua visita.",
        product ? `Se quiser retomar a pesquisa sobre ${product} com calma, temos um convite que pode fazer sentido.` : "Se quiser retomar a pesquisa com calma, temos um convite que pode fazer sentido.",
        product ? `Sua visita ajudou a conhecer alternativas de ${product}, e este evento pode continuar essa pesquisa.` : "Sua visita ajudou a conhecer alternativas, e este evento pode continuar essa pesquisa.",
      ];
    case "reengagement":
      return [
        product ? `Sei que a rotina corre e talvez o projeto com ${product} tenha ficado para depois; quis apenas deixar uma informação por aqui.` : "Sei que a rotina corre e talvez o projeto tenha ficado para depois; quis apenas deixar uma informação por aqui.",
        product ? `Talvez você não tenha conseguido avançar na escolha de ${product}, e está tudo bem. Tenho só um convite para compartilhar.` : "Talvez você não tenha conseguido avançar, e está tudo bem. Tenho só um convite para compartilhar.",
        product ? `Passando sem pressa para dividir algo que pode ser útil na busca por ${product}.` : "Passando sem pressa para dividir algo que pode ser útil.",
        product ? `Não sei se você já resolveu essa etapa de ${product}; de todo modo, achei válido avisar.` : "Não sei se você já resolveu essa etapa; de todo modo, achei válido avisar.",
        product ? `Só quis deixar esta informação por aqui, caso ${product} ainda esteja nos seus planos.` : "Só quis deixar esta informação por aqui, caso o projeto ainda esteja nos seus planos.",
        product ? `Se as prioridades mudaram e ${product} ficou para outro momento, sem problema; ainda assim, fica o convite.` : "Se as prioridades mudaram, sem problema; ainda assim, fica o convite.",
        product ? `Retomo nosso contato apenas para dividir uma novidade ligada à sua procura por ${product}.` : "Retomo nosso contato apenas para dividir uma novidade.",
        product ? `Sem querer interromper sua rotina, pensei que este aviso poderia ajudar na decisão sobre ${product}.` : "Sem querer interromper sua rotina, pensei que este aviso poderia ajudar.",
        product ? `Talvez agora não seja o momento para ${product}, mas quis deixar esta oportunidade no seu radar.` : "Talvez agora não seja o momento, mas quis deixar esta oportunidade no seu radar.",
        product ? `Quando puder, veja esta novidade sobre opções de ${product}; não precisa responder agora.` : "Quando puder, veja esta novidade; não precisa responder agora.",
        product ? `Como nem sempre dá para decidir tudo de uma vez, inclusive ${product}, separei uma informação para você.` : "Como nem sempre dá para decidir tudo de uma vez, separei uma informação para você.",
        product ? `Um contato rápido, sem cobrança: temos um convite que pode interessar se ${product} ainda fizer parte do projeto.` : "Um contato rápido, sem cobrança: temos um convite que pode interessar se o projeto ainda estiver em aberto.",
      ];
    case "construction":
      return [
        product ? `Pensando na sua obra ou reforma e na etapa de ${product}, quis compartilhar um convite que pode ajudar.` : "Pensando na sua obra ou reforma, quis compartilhar um convite que pode ajudar.",
        product ? `Quem está em obra sabe que são muitas decisões; pensei em facilitar a pesquisa sobre ${product}.` : "Quem está em obra sabe que são muitas decisões; pensei em facilitar sua pesquisa.",
        product ? `Entre tantos detalhes do projeto, incluindo ${product}, esta informação pode ser útil.` : "Entre tantos detalhes do projeto, esta informação pode ser útil.",
        product ? `Se você chegou à fase de escolher ${product}, queria avisar de uma programação da Mult Portas.` : "Se você chegou à fase de escolher portas e janelas, queria avisar de uma programação da Mult Portas.",
        product ? `Enquanto organiza as próximas etapas e a compra de ${product}, vale ter mais uma opção para consultar.` : "Enquanto organiza as próximas etapas, vale ter mais uma opção para consultar.",
        product ? `Cada escolha da obra pede comparação; este convite pode ajudar na parte de ${product}.` : "Cada escolha da obra pede comparação; este convite pode ajudar.",
        product ? `Para deixar sua pesquisa sobre ${product} mais prática, separei uma informação da Mult Portas.` : "Para deixar sua pesquisa mais prática, separei uma informação da Mult Portas.",
        product ? `Quando chega a hora de definir acabamentos e aberturas como ${product}, conhecer alternativas faz diferença.` : "Quando chega a hora de definir acabamentos e aberturas, conhecer alternativas faz diferença.",
        product ? `Se você está conciliando medidas, materiais e orçamento para ${product}, este convite pode ajudar na comparação.` : "Se você está conciliando medidas, materiais e orçamento, este convite pode ajudar na comparação.",
        product ? `No ritmo da reforma, uma nova referência pode ser útil na escolha de ${product}.` : "No ritmo da reforma, uma nova referência pode ser útil.",
        product ? `Quis trazer uma opção a mais para considerar no projeto em relação a ${product}.` : "Quis trazer uma opção a mais para considerar no projeto.",
        product ? `Tenho um convite que pode apoiar suas próximas decisões na obra, especialmente sobre ${product}.` : "Tenho um convite que pode apoiar suas próximas decisões na obra.",
      ];
    case "price":
      return [
        product ? `Como o valor faz diferença na escolha de ${product}, pensei que este convite poderia interessar.` : "Como o valor faz diferença na escolha, pensei que este convite poderia interessar.",
        product ? `Se a ideia é fazer o orçamento render na compra de ${product}, tenho uma informação para compartilhar.` : "Se a ideia é fazer o orçamento render, tenho uma informação para compartilhar.",
        product ? `Para quem gosta de comparar antes de comprar, principalmente ${product}, este evento pode ser útil.` : "Para quem gosta de comparar antes de comprar, este evento pode ser útil.",
        product ? `Como preço é um ponto importante na busca por ${product}, achei válido avisar.` : "Como preço é um ponto importante para você, achei válido avisar.",
        product ? `Uma compra bem pensada começa por entender as condições de ${product}; por isso, lembrei de você.` : "Uma compra bem pensada começa por entender as condições; por isso, lembrei de você.",
        product ? `Para escolher ${product} com calma e cuidar do orçamento, vale conhecer mais de uma alternativa.` : "Para escolher com calma e cuidar do orçamento, vale conhecer mais de uma alternativa.",
        product ? `Pensando no equilíbrio entre necessidade e valor para ${product}, quis compartilhar este convite.` : "Pensando no equilíbrio entre necessidade e valor, quis compartilhar este convite.",
        product ? `Antes de decidir, pode ser útil comparar condições para ${product}; esta programação permite fazer isso.` : "Antes de decidir, pode ser útil comparar condições; esta programação permite fazer isso.",
        product ? `Quis avisar de uma oportunidade para pesquisar preços e opções de ${product} com tranquilidade.` : "Quis avisar de uma oportunidade para pesquisar preços e opções com tranquilidade.",
        product ? `Se você está tentando encaixar ${product} no orçamento, esta informação pode ajudar.` : "Se você está tentando encaixar a compra no orçamento, esta informação pode ajudar.",
        product ? `Preço é uma parte importante da decisão sobre ${product}, então este evento merece entrar na comparação.` : "Preço é uma parte importante da decisão, então este evento merece entrar na comparação.",
        product ? `Com um orçamento planejado para ${product}, conhecer a condição disponível pode ajudar na escolha.` : "Com um orçamento planejado, conhecer a condição disponível pode ajudar na escolha.",
      ];
    case "returning":
      return [
        product ? `Faz tempo que a gente não se fala, e quis fazer um novo convite relacionado a ${product}.` : "Faz tempo que a gente não se fala, e quis fazer um novo convite.",
        product ? `É bom falar novamente com quem já conhece a Mult Portas; queria compartilhar uma novidade sobre ${product}.` : "É bom falar novamente com quem já conhece a Mult Portas; queria compartilhar uma novidade.",
        product ? `Como você já foi atendido pela nossa equipe, lembrei de avisar desta programação com opções de ${product}.` : "Como você já foi atendido pela nossa equipe, lembrei de avisar desta programação.",
        product ? `Ao preparar este convite, lembrei de você e do interesse em ${product}.` : "Ao preparar este convite, lembrei de você.",
        product ? `Quis retomar nosso contato de um jeito simples e contar que temos opções de ${product} no evento.` : "Quis retomar nosso contato de um jeito simples e contar que temos um evento chegando.",
        product ? `É sempre bom manter contato com quem já passou pela Mult Portas; fica este convite para olhar ${product}.` : "É sempre bom manter contato com quem já passou pela Mult Portas; fica este convite.",
        product ? `Talvez tenha surgido um novo projeto com ${product}; se for o caso, esta informação pode ser útil.` : "Talvez tenha surgido um novo projeto; se for o caso, esta informação pode ser útil.",
        product ? `Mesmo sem saber se existe uma nova necessidade de ${product}, achei que você gostaria de conhecer a programação.` : "Mesmo sem saber se existe uma nova necessidade, achei que você gostaria de conhecer a programação.",
        product ? `Você já conhece nosso atendimento, por isso quis compartilhar diretamente esta novidade sobre ${product}.` : "Você já conhece nosso atendimento, por isso quis compartilhar esta novidade diretamente.",
        product ? `Queria aproveitar a ocasião para renovar nosso contato e conversar novamente sobre ${product}.` : "Queria aproveitar a ocasião para renovar nosso contato.",
        product ? `Foi um prazer atender você no passado; agora, temos um novo convite com alternativas de ${product}.` : "Foi um prazer atender você no passado; agora, temos um novo convite.",
        product ? `Se apareceu uma nova necessidade para a casa envolvendo ${product}, esta pode ser uma boa ocasião para nos visitar.` : "Se apareceu uma nova necessidade para a casa, esta pode ser uma boa ocasião para nos visitar.",
      ];
    default:
      return [
        product ? `Queria fazer um convite da Mult Portas, especialmente se ${product} estiver nos seus planos.` : "Queria fazer um convite da Mult Portas.",
        product ? `Separei uma informação que pode ajudar nas escolhas para sua casa, inclusive sobre ${product}.` : "Separei uma informação que pode ajudar nas escolhas para sua casa.",
        product ? `Se estiver pesquisando ${product} para seu projeto, tenho um convite que pode ser útil.` : "Se estiver pesquisando opções para seu projeto, tenho um convite que pode ser útil.",
        product ? `Surgiu uma ocasião para conhecer alternativas de ${product} com calma.` : "Surgiu uma ocasião para conhecer alternativas com calma.",
        product ? `Passando para dividir uma novidade que talvez combine com seus planos para ${product}.` : "Passando para dividir uma novidade que talvez combine com seus planos.",
        product ? `Quero deixar uma sugestão no seu radar sobre ${product}: temos um convite para você.` : "Quero deixar uma sugestão no seu radar: temos um convite para você.",
        product ? `Conhecer opções de ${product} ajuda a escolher com tranquilidade, então quis avisar de um evento.` : "Conhecer opções ajuda a escolher com tranquilidade, então quis avisar de um evento.",
        product ? `Se estiver pensando em renovar algum espaço com ${product}, queria compartilhar esta programação.` : "Se estiver pensando em renovar algum espaço, queria compartilhar esta programação.",
        product ? `Temos um evento que pode ser uma boa oportunidade para pesquisar opções de ${product}.` : "Temos um evento que pode ser uma boa oportunidade para pesquisar opções.",
        product ? `Talvez este convite seja útil para uma escolha futura de ${product}, por isso pensei em você.` : "Talvez este convite seja útil para uma escolha futura, por isso quis compartilhar.",
        product ? `Queria contar de uma ação com diferentes opções para a casa, entre elas ${product}.` : "Queria contar de uma ação com diferentes opções para a casa.",
        product ? `Caso esteja começando uma pesquisa por ${product}, este convite pode ajudar a conhecer alternativas.` : "Caso esteja começando uma pesquisa, este convite pode ajudar a conhecer alternativas.",
      ];
  }
}

function spokenDate(value) {
  const months = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  return value.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (match, day, month, year) => {
    const monthName = months[Number(month) - 1];
    if (!monthName) return `dia ${match}`;
    const normalizedYear = year && year.length === 2 ? `20${year}` : year;
    return `dia ${Number(day)} de ${monthName}${normalizedYear ? ` de ${normalizedYear}` : ""}`;
  });
}

function spokenDiscount(value) {
  return value.replace(/\s*OFF\b/i, " de desconto");
}

function eventOptions({ eventName, eventDate, eventTime, city, discount }) {
  const products = "portas e janelas de aço, alumínio e madeira";
  return [
    `Neste ${eventDate}, teremos o ${eventName}, ${eventTime}, em ${city}, com ${discount} em ${products}.`,
    `O ${eventName} acontece ${eventDate}, ${eventTime}, em ${city}. A condição anunciada é ${discount} em ${products}.`,
    `Anote as informações: ${eventName}, ${eventDate}, ${eventTime}, em ${city}, com ${discount} em ${products}.`,
    `${eventDate}, a Mult Portas recebe você em ${city}, ${eventTime}, para o ${eventName}, com ${discount} em ${products}.`,
    `O encontro está marcado: ${eventName}, ${eventDate}, ${eventTime}, em ${city}. Teremos ${discount} em ${products}.`,
    `A data do ${eventName} é ${eventDate}, ${eventTime}, em ${city}, com ${discount} em ${products}.`,
    `Em ${city}, o ${eventName} será ${eventDate}, ${eventTime}. A condição principal é ${discount} em ${products}.`,
    `Guarde esta informação: ${eventDate}, ${eventTime}, em ${city}, acontece o ${eventName}, com ${discount} em ${products}.`,
    `A programação do ${eventName} será ${eventDate}, ${eventTime}, em ${city}, com ${discount} em ${products}.`,
    `Teremos uma edição do ${eventName} ${eventDate}, ${eventTime}, em ${city}, reunindo ${products} com ${discount}.`,
    `A Mult Portas abre as portas em ${city} para o ${eventName}, ${eventDate}, ${eventTime}, com ${discount} em ${products}.`,
    `O convite é para o ${eventName}: ${eventDate}, ${eventTime}, em ${city}, com ${discount} em ${products}.`,
  ];
}

function benefitOptions(interest) {
  const product = interest ? interest.toLocaleLowerCase("pt-BR") : "";
  return product ? [
    `Pode ser uma boa oportunidade para olhar opções de ${product} com calma.`,
    `Assim, dá para comparar materiais e alternativas de ${product} no seu tempo.`,
    `Você poderá conhecer opções de ${product} e tirar dúvidas antes de decidir.`,
    `A visita pode facilitar a avaliação de ${product} sem compromisso.`,
    `Se tiver medidas ou referências, elas podem ajudar na conversa sobre ${product}.`,
    `Dá para observar acabamentos e composições de ${product} lado a lado.`,
    `A equipe pode orientar a comparação de ${product} conforme a necessidade do seu projeto.`,
    `É um momento para entender melhor as diferenças entre as opções de ${product}.`,
    `Você pode usar a visita para conferir detalhes de ${product} que nem sempre ficam claros à distância.`,
    `Se quiser focar em ${product}, a conversa pode começar exatamente por essa necessidade.`,
    `A ideia é deixar a escolha de ${product} mais informada e tranquila.`,
    `Pode ser útil ver ${product} pessoalmente antes de definir o próximo passo.`,
  ] : [
    "Pode ser uma boa oportunidade para comparar as opções com calma.",
    "Assim, dá para comparar materiais e alternativas no seu tempo.",
    "Você poderá conhecer as opções e tirar dúvidas antes de decidir.",
    "A visita pode facilitar sua avaliação sem compromisso.",
    "Se tiver medidas ou referências, elas podem ajudar na conversa.",
    "Dá para observar acabamentos e composições lado a lado.",
    "A equipe pode orientar a comparação conforme a necessidade do seu projeto.",
    "É um momento para entender melhor as diferenças entre as opções.",
    "Você pode usar a visita para conferir detalhes que nem sempre ficam claros à distância.",
    "Se quiser focar em uma necessidade específica, a conversa pode começar por ela.",
    "A ideia é deixar sua escolha mais informada e tranquila.",
    "Pode ser útil ver as alternativas pessoalmente antes de definir o próximo passo.",
  ];
}

function closingOptions(tone, interest) {
  const product = interest ? interest.toLocaleLowerCase("pt-BR") : "";
  const optionsText = product ? ` de ${product}` : "";
  if (tone === "direct") return [
    `Se quiser, posso adiantar algumas opções${optionsText} antes da visita. Você pretende passar por aqui?`,
    "Posso enviar a localização e os dados do evento. Quer receber?",
    `Se a condição fizer sentido, posso ajudar a comparar as opções${optionsText}. Você quer mais detalhes?`,
    product ? `Posso passar a localização e orientar por onde começar a olhar ${product}. Posso enviar?` : "Posso passar a localização e orientar por onde começar. Posso enviar?",
    "Se quiser conferir pessoalmente, eu passo os dados de chegada. Pretende visitar o Feirão?",
    `Posso resumir os pontos para comparar${optionsText} antes de você decidir. Quer que eu envie?`,
    "Quer que eu envie data, horário e localização em uma mensagem curta?",
    product ? `Você quer receber primeiro as informações de ${product} ou a localização do Feirão?` : "Você quer receber primeiro as opções ou a localização do Feirão?",
    "Se a visita estiver nos seus planos, posso te passar o caminho. Quer que eu envie?",
    product ? `Quer que eu organize uma comparação inicial de ${product} para facilitar sua visita?` : "Quer que eu organize uma comparação inicial para facilitar sua visita?",
    "Posso mandar agora as informações essenciais do evento. Faz sentido para você?",
    "Quer que eu deixe a localização e o horário prontos para você consultar?",
  ];
  if (tone === "persuasive") return [
    `Pode ser um bom momento para comparar opções${optionsText} e buscar uma condição interessante, sem compromisso. Quer que eu ajude a organizar essa comparação?`,
    `Comparar as opções${optionsText} durante o Feirão pode deixar a escolha mais clara. Quer que eu envie a localização?`,
    `Você pode aproveitar a visita para avaliar acabamento, composição e condição${optionsText} com calma. Quer receber os detalhes?`,
    product ? `Se ${product} ainda estiver nos seus planos, vale conhecer as alternativas e decidir sem pressão. Posso passar as informações?` : "Se o projeto ainda estiver nos seus planos, vale conhecer as alternativas e decidir sem pressão. Posso passar as informações?",
    `O Feirão pode facilitar a comparação${optionsText} em um só momento. Quer que eu mostre por onde começar?`,
    `Será uma oportunidade para tirar dúvidas e comparar opções${optionsText} antes de decidir. Quer receber a localização?`,
    product ? `Ver as alternativas de ${product} pessoalmente pode trazer mais segurança para a escolha. Quer que eu envie os dados?` : "Ver as alternativas pessoalmente pode trazer mais segurança para a escolha. Quer que eu envie os dados?",
    "A ideia é você conhecer as possibilidades e decidir no seu ritmo. Posso te mandar o convite completo?",
    product ? `Se quiser aproveitar a visita para comparar ${product}, posso ajudar a planejar o que observar. Quer?` : "Se quiser aproveitar a visita para comparar opções, posso ajudar a planejar o que observar. Quer?",
    "Você pode ir com as dúvidas certas e sair com uma comparação mais clara. Quer que eu envie a localização?",
    "Se a condição combinar com seu momento, a visita pode valer a pena. Posso passar os detalhes?",
    product ? `Quer que eu destaque os pontos mais importantes para avaliar em ${product} durante o Feirão?` : "Quer que eu destaque os pontos mais importantes para avaliar durante o Feirão?",
  ];
  return [
    "Preparamos o evento para receber você com calma e ajudar no que precisar. Quer que eu envie a localização?",
    "Se fizer sentido para você, será um prazer receber você por aqui. Quer que eu mande a localização?",
    "Fique à vontade para olhar tudo no seu tempo. Posso passar os detalhes do Feirão?",
    "A equipe estará pronta para orientar com calma. Quer que eu envie as informações?",
    "Se quiser conhecer as opções sem compromisso, vai ser um prazer receber você. Posso mandar a localização?",
    "Estou por aqui para ajudar no que precisar. Quer receber os detalhes do evento?",
    "Você pode conhecer as opções com tranquilidade e decidir depois. Quer que eu envie o endereço?",
    product ? `Se quiser, começo enviando as informações de ${product} e a localização. Pode ser?` : "Se quiser, começo enviando as informações e a localização. Pode ser?",
    "Quero que o convite seja útil para o seu momento. Posso te passar os dados completos?",
    "Conte comigo para tirar dúvidas antes da visita. Quer que eu envie a localização?",
    "Sem pressa e sem compromisso: você conhece as opções e avalia com calma. Quer receber os detalhes?",
    "Se quiser dar o próximo passo, eu facilito as informações para você. Posso enviar?",
  ];
}

const whatsappStructures = [
  [["greeting", "sender"], ["context"], ["event"], ["benefit"], ["closing"]],
  [["greeting"], ["sender", "context"], ["event", "benefit"], ["closing"]],
  [["greeting", "sender"], ["event"], ["context", "benefit"], ["closing"]],
  [["greeting"], ["sender"], ["event"], ["context"], ["benefit", "closing"]],
  [["greeting", "sender", "context"], ["event"], ["benefit"], ["closing"]],
  [["greeting", "sender"], ["context", "benefit"], ["event"], ["closing"]],
  [["greeting"], ["sender", "event"], ["context"], ["benefit"], ["closing"]],
  [["greeting", "sender"], ["event", "context"], ["benefit"], ["closing"]],
  [["greeting", "sender"], ["context"], ["benefit", "event"], ["closing"]],
  [["greeting"], ["sender"], ["context", "event"], ["benefit", "closing"]],
  [["greeting", "sender", "context"], ["event", "benefit"], ["closing"]],
  [["greeting", "sender"], ["event"], ["context"], ["benefit"], ["closing"]],
];

const audioBodyOrders = [
  ["context", "event", "benefit"],
  ["context", "benefit", "event"],
  ["event", "context", "benefit"],
  ["event", "benefit", "context"],
  ["benefit", "context", "event"],
  ["benefit", "event", "context"],
  ["context", "event", "benefit"],
  ["event", "context", "benefit"],
  ["context", "benefit", "event"],
  ["benefit", "context", "event"],
  ["event", "benefit", "context"],
  ["benefit", "event", "context"],
];

const audioLeadIns = [
  "",
  "Queria falar de forma bem simples.",
  "O motivo do contato é este.",
  "Passei para deixar a informação completa.",
  "Vou contar os pontos principais.",
  "A ideia é facilitar sua escolha.",
  "Queria explicar por que lembrei de você.",
  "Tenho um convite e uma informação prática.",
  "Vou resumir para ficar fácil.",
  "Antes de qualquer decisão, vale conhecer os detalhes.",
  "Queria compartilhar isso sem pressa.",
  "O convite é simples.",
];

function resolveEmojiMode(input, variation, channel) {
  if (channel === "Áudio") return "none";
  const requested = fairEmojiModes.some((mode) => mode.id === input.emojiMode)
    ? input.emojiMode
    : input.includeEmojis === false ? "none" : "light";
  if (requested !== "mixed") return requested;
  return ["light", "none", "balanced", "expressive"][variation % 4];
}

function emojiSlots(mode, index) {
  const empty = { greeting: "", event: "", benefit: "", closing: "" };
  if (mode === "none") return empty;
  const light = [
    { greeting: " 😊", event: "", benefit: "", closing: "" }, { greeting: "", event: "📍 ", benefit: "", closing: "" },
    { greeting: "", event: "", benefit: "🚪 ", closing: "" }, { greeting: "", event: "", benefit: "", closing: "🤝 " },
    { greeting: " 👋", event: "", benefit: "", closing: "" }, { greeting: "", event: "✨ ", benefit: "", closing: "" },
    { greeting: "", event: "", benefit: "🏠 ", closing: "" }, { greeting: "", event: "", benefit: "", closing: "💬 " },
    { greeting: " 🙂", event: "", benefit: "", closing: "" }, { greeting: "", event: "📅 ", benefit: "", closing: "" },
    { greeting: "", event: "", benefit: "🔎 ", closing: "" }, { greeting: "", event: "", benefit: "", closing: "📌 " },
  ];
  if (mode === "light") return light[index % light.length];
  const balanced = [
    { greeting: " 😊", event: "📍 ", benefit: "", closing: "" }, { greeting: " 👋", event: "", benefit: "🚪 ", closing: "" },
    { greeting: "", event: "✨ ", benefit: "", closing: "🤝 " }, { greeting: " 🙂", event: "📅 ", benefit: "", closing: "" },
    { greeting: "", event: "📍 ", benefit: "🏠 ", closing: "" }, { greeting: " 😊", event: "", benefit: "", closing: "💬 " },
    { greeting: "", event: "✨ ", benefit: "🔎 ", closing: "" }, { greeting: " 👋", event: "", benefit: "", closing: "📌 " },
    { greeting: "", event: "📅 ", benefit: "🚪 ", closing: "" }, { greeting: " 🙂", event: "", benefit: "", closing: "🤝 " },
    { greeting: "", event: "📍 ", benefit: "", closing: "💬 " }, { greeting: " 😊", event: "✨ ", benefit: "", closing: "" },
  ];
  if (mode === "balanced") return balanced[index % balanced.length];
  const expressive = [
    { greeting: " 😊", event: "📍 ", benefit: "🚪 ", closing: "🤝 " }, { greeting: " 👋", event: "✨ ", benefit: "🏠 ", closing: "💬 " },
    { greeting: " 🙂", event: "📅 ", benefit: "🔎 ", closing: "📌 " }, { greeting: " 😊", event: "✨ ", benefit: "🚪 ", closing: "💬 " },
    { greeting: " 👋", event: "📍 ", benefit: "🏠 ", closing: "🤝 " }, { greeting: " 🙂", event: "📅 ", benefit: "🚪 ", closing: "💬 " },
    { greeting: " 😊", event: "📍 ", benefit: "🔎 ", closing: "📌 " }, { greeting: " 👋", event: "✨ ", benefit: "🏠 ", closing: "🤝 " },
    { greeting: " 🙂", event: "📅 ", benefit: "🔎 ", closing: "💬 " }, { greeting: " 😊", event: "✨ ", benefit: "🚪 ", closing: "📌 " },
    { greeting: " 👋", event: "📍 ", benefit: "🔎 ", closing: "🤝 " }, { greeting: " 🙂", event: "📅 ", benefit: "🏠 ", closing: "💬 " },
  ];
  return expressive[index % expressive.length];
}

function decorateComponents(components, slots) {
  return {
    ...components,
    greeting: `${components.greeting}${slots.greeting}`,
    event: `${slots.event}${components.event}`,
    benefit: `${slots.benefit}${components.benefit}`,
    closing: `${slots.closing}${components.closing}`,
  };
}

function composeWhatsApp(components, structureIndex) {
  return whatsappStructures[structureIndex].map((paragraph) => paragraph.map((key) => components[key]).join(" ")).join("\n\n");
}

function composeAudio(components, structureIndex) {
  const body = audioBodyOrders[structureIndex].map((key) => components[key]);
  return [components.greeting, components.sender, audioLeadIns[structureIndex], ...body, components.closing].filter(Boolean).join(" ");
}

export function buildFairMessage(input = {}) {
  const profileId = fairClientProfiles.some((profile) => profile.id === input.profileId) ? input.profileId : "neutral";
  const tone = fairToneOptions.some((option) => option.id === input.tone) ? input.tone : "welcoming";
  const channel = input.channel === "Áudio" ? "Áudio" : "WhatsApp";
  const clientName = cleanText(input.clientName, 120);
  const consultantName = cleanText(input.consultantName, 120);
  const interest = cleanText(input.interest, 160);
  const eventName = cleanText(input.eventName, 160) || fairDefaults.eventName;
  const eventDate = cleanText(input.eventDate, 80) || fairDefaults.eventDate;
  const eventTime = cleanText(input.eventTime, 80) || fairDefaults.eventTime;
  const city = cleanText(input.city, 120) || fairDefaults.city;
  const discount = cleanText(input.discount, 80) || fairDefaults.discount;
  const variation = normalizeVariation(input.variation);
  const recipe = fairVariationRecipe(variation);
  const spoken = channel === "Áudio";
  const eventFacts = { eventName, eventDate: spoken ? spokenDate(eventDate) : eventDate, eventTime, city, discount: spoken ? spokenDiscount(discount) : discount };
  const baseComponents = {
    greeting: pickVariant(greetingOptions(clientName), recipe.greeting),
    sender: pickVariant(senderOptions(consultantName), recipe.sender),
    context: pickVariant(profileHookOptions(profileId, interest), recipe.context),
    event: pickVariant(eventOptions(eventFacts), recipe.event),
    benefit: pickVariant(benefitOptions(interest), recipe.benefit),
    closing: pickVariant(closingOptions(tone, interest), recipe.closing),
  };
  const mode = resolveEmojiMode(input, variation, channel);
  const components = decorateComponents(baseComponents, emojiSlots(mode, recipe.structure));
  return spoken ? composeAudio(components, recipe.structure) : composeWhatsApp(components, recipe.structure);
}
