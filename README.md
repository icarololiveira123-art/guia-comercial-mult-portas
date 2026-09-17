# Guia Comercial Mult Portas

Aplicação interna para atendimento comercial, acompanhamento individual e treinamento de conversas da equipe Mult Portas.

Produção: [guia-comercial-mult-portas.eletrovale-cont.chatgpt.site](https://guia-comercial-mult-portas.eletrovale-cont.chatgpt.site)

## O que está incluído

- acesso e cadastro separados do conteúdo do guia;
- sessão individual e dados persistidos por funcionário;
- gestão protegida de perfis, registros e evolução da equipe;
- roteiro comercial, timing, mensagens, controle de carteira e requisição de fábrica;
- catálogo rápido das marcas estudadas;
- 16 cenários de treinamento, avaliação por cinco competências e índice de aprendizado;
- treinador generativo opcional pela Responses API e modo guiado local como contingência;
- telas de recuperação para evitar página branca em falhas de renderização.

## Arquitetura

- Next.js 16 + React 19 sobre Vinext/Vite;
- Cloudflare Worker como entrada HTTP;
- Cloudflare D1 e Drizzle para usuários, sessões e estado individual;
- inicialização idempotente do esquema D1 para recuperar automaticamente bancos novos ou ainda não migrados;
- cookies de sessão `HttpOnly`, validação de origem e respostas de API sem cache;
- estado persistido com contrato versionado, limites de tamanho e normalização no servidor;
- GitHub como espelho versionado do código; o domínio oficial do Sites é o único runtime autenticado.

A tela de autenticação vive em `app/auth-screen.tsx`. O conteúdo do guia permanece em `app/page.tsx`, de modo que atualizações do conteúdo não alterem a fronteira de acesso.

## Variáveis de runtime

Configure os valores apenas no ambiente de hospedagem. Nunca grave segredos no código ou no Git:

- `ADMIN_PASSWORD`: segredo administrativo do servidor;
- `OPENAI_API_KEY`: opcional; habilita o treinador generativo;
- `OPENAI_MODEL`: opcional; o padrão é `gpt-5.6-terra`.

Sem `OPENAI_API_KEY`, o laboratório continua operando no modo guiado, sem chamadas pagas.

## Desenvolvimento e validação

Requisitos: Node.js `>=22.13.0`, Bash, `curl` e GNU `timeout`.

```bash
npm ci
npm run dev
npm run lint
npm test
npm run test:e2e
npm run validate:artifact
```

`npm test` compila a aplicação e executa os contratos de autenticação, segurança, estado, hashing, renderização, exportação Excel, recuperação do esquema e qualidade do treinador. `npm run test:e2e` sobe D1 e o Worker localmente para validar cadastro zerado, persistência após sair e entrar, isolamento entre contas e bloqueio de origem externa.

## Persistência e privacidade

O D1 é a fonte de verdade. O navegador mantém somente uma cópia temporária e vinculada ao ID do funcionário para tolerar interrupções de rede. Uma resposta vazia bem-sucedida do servidor é tratada como conta nova e limpa qualquer cópia local antiga.

A exportação de requisições gera um arquivo `.xlsx` nativo no navegador, preserva preços como números e trata todo texto como conteúdo literal — inclusive quando começa com `=`, `+`, `-` ou `@` — para não executar fórmulas vindas de campos preenchidos.

As conversas enviadas ao treinador generativo usam `store: false`, identificador de segurança pseudonimizado, payload limitado e saída estruturada. A fala do cliente passa por uma política adicional para impedir que o simulador responda como vendedor ou treinador.
