function cleanText(value, maxLength = 240) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function asQuestion(value, fallback) {
  const question = cleanText(value, 240) || fallback;
  return /[?!…]$/.test(question) ? question : `${question}?`;
}

export const providerTypeOptions = [
  "Prestador de Serviço",
  "Empreiteiro ou construtor",
  "Instalador de portas ou esquadrias",
  "Arquiteto ou designer",
  "Engenheiro",
  "Marceneiro",
  "Serralheiro ou vidraceiro",
  "Profissional de reformas",
];

export const providerCompanyTypeOptions = [
  "Construção civil e empreendimentos",
  "Reformas e manutenção predial",
  "Arquitetura e projetos",
  "Engenharia e obras",
  "Instalação de portas e esquadrias",
  "Administração de condomínios",
  "Marcenaria e interiores",
  "Revenda de materiais de construção",
];

export const providerGoalOptions = [
  "me apresentar e deixar nosso contato para as próximas obras",
  "ajudar nas cotações de portas e esquadrias dos seus clientes",
  "manter contato para futuras indicações e demandas",
  "entender que tipo de obra você atende com mais frequência",
  "facilitar a escolha e a cotação de materiais para seus clientes",
  "mostrar as linhas que podem ajudar no seu dia a dia",
];

export const providerCompanyGoalOptions = [
  "apresentar nosso trabalho e deixar o atendimento à disposição",
  "avaliar uma possível parceria para futuras obras",
  "apoiar a empresa nas cotações de portas e esquadrias",
  "facilitar a especificação de produtos para os projetos",
  "disponibilizar nosso portfólio para futuras demandas",
  "criar um canal direto para compras, cotações e indicações",
];

export const providerQuestionOptions = [
  "você costuma indicar portas e esquadrias para os seus clientes?",
  "você atende obras em Araraquara ou também nas cidades da região?",
  "posso te enviar uma apresentação curta da Mult Portas?",
  "quando aparece essa necessidade na obra, você ajuda o cliente a escolher o material?",
  "tem alguma obra em andamento que precise de cotação?",
];

export const providerCompanyQuestionOptions = [
  "vocês costumam comprar ou indicar portas e esquadrias para as obras?",
  "com quem posso conversar sobre compras e cotações?",
  "posso enviar uma apresentação curta e o nosso portfólio?",
  "vocês atendem projetos em Araraquara e nas cidades da região?",
  "há alguma obra em andamento em que possamos ajudar com uma cotação?",
  "qual é o melhor contato para futuras demandas?",
];

export const providerMessageExamples = [
  {
    id: "provider-service-professional",
    tag: "Prestador de Serviço · primeiro contato",
    title: "Apresentação simples e cordial",
    message: "Oi, [nome]! Tudo bem? Aqui é [seu nome], da Mult Portas. Vi que você trabalha com obras na região e queria me apresentar. Trabalhamos com portas e esquadrias e podemos ajudar quando você ou algum cliente precisar de cotação. Você costuma indicar esse tipo de material nas obras?",
  },
  {
    id: "provider-builder",
    tag: "Prestador de Serviço ou empreiteiro",
    title: "Contato para a próxima obra",
    message: "Oi, [nome]! Tudo bem? Aqui é [seu nome], da Mult Portas. A gente trabalha com portas e esquadrias e também ajuda a organizar as opções antes da cotação. Queria deixar nosso contato à disposição para quando aparecer alguma demanda na obra. Posso te enviar uma apresentação curta?",
  },
  {
    id: "provider-installer",
    tag: "Instalador ou marceneiro",
    title: "Contato profissional",
    message: "Oi, [nome]! Tudo bem? Aqui é [seu nome], da Mult Portas. Vi que você trabalha com instalação e acabamento de portas e achei que seria bom mantermos contato. Temos várias linhas de portas e esquadrias e podemos ajudar nas cotações dos seus clientes. Você atende Araraquara ou também outras cidades da região?",
  },
  {
    id: "provider-renovation",
    tag: "Profissional de reformas",
    title: "Contato para futuras demandas",
    message: "Oi, [nome]! Tudo bem? Aqui é [seu nome], da Mult Portas. Vi que você trabalha com reformas e queria deixar nosso contato para as próximas obras. Temos portas e esquadrias de várias linhas e ajudamos desde a escolha até a cotação. Quando o cliente precisa desse material, você costuma ajudar na indicação?",
  },
];

export const providerCompanyMessageExamples = [
  {
    id: "company-institutional",
    tag: "Empresa · apresentação institucional",
    title: "Apresentação curta e profissional",
    message: "Olá, [empresa ou contato], tudo bem? Meu nome é [seu nome] e falo pela Mult Portas. Trabalhamos há 41 anos com portas e esquadrias e atendemos 85 cidades. Gostaria de apresentar nosso trabalho e deixar o atendimento à disposição para futuras obras. Posso enviar uma apresentação curta e o nosso portfólio?",
  },
  {
    id: "company-builder",
    tag: "Construtora ou incorporadora",
    title: "Apoio para obras e projetos",
    message: "Olá, [empresa ou contato], tudo bem? Meu nome é [seu nome] e falo pela Mult Portas. Fornecemos portas e esquadrias para diferentes tipos de obra e também ajudamos na especificação e na cotação. Gostaria de entender como vocês trabalham hoje com esse material. Com quem posso conversar sobre compras e cotações?",
  },
  {
    id: "company-office",
    tag: "Arquitetura ou engenharia",
    title: "Parceria em especificação",
    message: "Olá, [empresa ou contato], tudo bem? Sou [seu nome], da Mult Portas. Trabalhamos com diferentes linhas de portas e esquadrias e podemos apoiar a escolha e a cotação de acordo com cada projeto. Queria deixar nosso contato à disposição. Há alguma obra em andamento em que possamos ajudar com uma cotação?",
  },
  {
    id: "company-maintenance",
    tag: "Reformas ou manutenção",
    title: "Canal comercial para demandas",
    message: "Olá, [empresa ou contato], tudo bem? Meu nome é [seu nome] e falo pela Mult Portas. Atendemos Araraquara e diversas cidades da região com portas e esquadrias para reformas e manutenção. Gostaria de deixar nosso atendimento disponível para futuras demandas. Qual é o melhor contato para falarmos sobre cotações?",
  },
];

export function buildProviderMessage(input = {}) {
  const profile = input.profile === "Empresa" ? "Empresa" : "Prestador de Serviço";
  const contactName = cleanText(input.contactName, 120);
  const senderName = cleanText(input.senderName, 120);
  const providerType = cleanText(input.providerType, 160) || (profile === "Empresa" ? "construção civil e obras" : "serviços da construção");
  const region = cleanText(input.region, 160);
  const objective = cleanText(input.objective, 240) || (profile === "Empresa" ? "apresentar nosso trabalho e deixar o atendimento à disposição" : "me apresentar e deixar nosso contato para as próximas obras");
  const question = asQuestion(input.question, profile === "Empresa" ? "vocês costumam comprar ou indicar portas e esquadrias para as obras" : "você costuma indicar portas e esquadrias para os seus clientes");
  const tone = ["Consultivo", "Direto", "Próximo"].includes(input.tone) ? input.tone : "Consultivo";

  const professionalLabel = providerType.toLocaleLowerCase("pt-BR");
  const lowerQuestion = `${question.charAt(0).toLocaleLowerCase("pt-BR")}${question.slice(1)}`;
  const capitalizedQuestion = `${question.charAt(0).toLocaleUpperCase("pt-BR")}${question.slice(1)}`;
  const punctuatedObjective = `${objective}${/[.!?]$/.test(objective) ? "" : "."}`;

  if (profile === "Empresa") {
    const greeting = contactName ? `Olá, ${contactName}, tudo bem?` : "Olá, tudo bem?";
    const sender = senderName ? `Meu nome é ${senderName} e falo pela Mult Portas.` : "Falo pela equipe comercial da Mult Portas.";
    const professional = region
      ? `Vi que vocês trabalham com ${professionalLabel} em ${region}.`
      : `Vi que vocês trabalham com ${professionalLabel}.`;
    const proof = [];
    if (input.includeCompany !== false) proof.push("A Mult Portas atua há 41 anos e atende 85 cidades.");
    if (input.includePortfolio !== false) proof.push("Trabalhamos com portas e esquadrias para diferentes tipos de obra.");
    if (input.includeSupport !== false) proof.push("Também ajudamos na especificação e na cotação.");
    const trust = proof.join(" ");

    if (tone === "Direto") return [greeting, sender, professional, `Entrei em contato para ${punctuatedObjective}`, trust, capitalizedQuestion].filter(Boolean).join(" ");
    if (tone === "Próximo") return [greeting, sender, professional, "Achei que valia a pena nos apresentarmos e mantermos esse contato.", `A ideia é ${punctuatedObjective}`, trust, `Se fizer sentido para vocês, ${lowerQuestion}`].filter(Boolean).join(" ");
    return [greeting, sender, professional, `Gostaria de ${punctuatedObjective}`, trust, `Se fizer sentido, ${lowerQuestion}`].filter(Boolean).join(" ");
  }

  const greeting = contactName ? `Oi, ${contactName}! Tudo bem?` : "Oi! Tudo bem?";
  const sender = senderName ? `Aqui é ${senderName}, da Mult Portas.` : "Aqui é o pessoal da Mult Portas.";
  const professional = region
    ? `Vi que você trabalha como ${professionalLabel} em ${region}.`
    : `Vi que você trabalha como ${professionalLabel}.`;
  const proof = [];
  if (input.includeCompany !== false) proof.push("A Mult Portas atua há 41 anos e atende 85 cidades.");
  if (input.includePortfolio !== false) proof.push("Temos portas e esquadrias para diferentes etapas da obra.");
  if (input.includeSupport !== false) proof.push("Também ajudamos a escolher as opções e organizar a cotação.");
  const trust = proof.join(" ");

  if (tone === "Direto") return [greeting, sender, professional, `Estou entrando em contato para ${punctuatedObjective}`, trust, capitalizedQuestion].filter(Boolean).join(" ");
  if (tone === "Próximo") return [greeting, sender, professional, "Achei que valia a pena a gente se conhecer.", `A ideia é ${punctuatedObjective}`, trust, `Se fizer sentido, ${lowerQuestion}`].filter(Boolean).join(" ");
  return [greeting, sender, professional, `Queria ${punctuatedObjective}`, trust, capitalizedQuestion].filter(Boolean).join(" ");
}
