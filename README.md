# Guia Comercial Mult Portas

Guia comercial para a equipe, com roteiro de atendimento, ferramentas de trabalho, catálogos e aulas para aprender sobre portas e esquadrias desde o início.

**Site no GitHub Pages:** [icarololiveira123-art.github.io/guia-comercial-mult-portas](https://icarololiveira123-art.github.io/guia-comercial-mult-portas/). Usa o endereço do próprio GitHub; não é necessário comprar domínio.

## O que há no guia

| Seção | Conteúdo |
| --- | --- |
| Visão geral | Atividades, estudo da marca, atendimentos e indicadores da conta. |
| Roteiro de venda | Etapas da conversa comercial, do diagnóstico ao próximo passo. |
| Ser um bom vendedor | Postura, perguntas e prática de atendimento. |
| Treino prático | Simulações de conversas e avaliação guiada. |
| Timing | Quando abordar, acompanhar e avançar com o cliente. |
| Mensagem rápida | Planejamento e cópia de mensagens comerciais. |
| Convite Feirão | Personalização de convites por perfil de cliente. |
| Requisição fábrica | Preenchimento e exportação de requisições. |
| Catálogos | Biblioteca de marcas com abas Aprender, Fichas e PDFs. |
| Controle | Pendências e carteira de clientes. |
| Marketing diário | Cinco contadores, resumo para WhatsApp e histórico por dia e por conta. |
| Gestão | Indicadores e rotina comercial pessoal. |

A navegação no topo reúne os módulos em Início, Aprender, Atender, Operação e Indicadores. Mensagens e Feirão usam etapas de contexto, prévia e modelos. Os módulos existentes e os dados de cada conta foram preservados.

O catálogo inclui trilhas para nove marcas, com noções de materiais, tipos de medida, pontos de qualidade, exemplos e perguntas com explicação. Há cinco catálogos Brimak em PDF, cada um com roteiro de estudo e exercício. O glossário ajuda a distinguir folha, conjunto e vão acabado.

O Marketing diário fica em Operação e nas ferramentas da página inicial. Os cinco contadores aceitam os botões +/− e edição direta. O resumo segue o formato da equipe e pode ser copiado. A troca de dia usa o horário de Brasília, abre contadores zerados e preserva até 366 dias registrados no histórico da própria conta. A ação Zerar contadores de hoje exige confirmação na tela e afeta apenas o dia atual.

As aulas são material de estudo. Confirme especificações, composição, medidas, disponibilidade, instalação, desempenho e garantia na ficha vigente do fabricante antes de orçar. Não há uma folga de instalação universal. O catálogo geral Brimak de 2018 serve como referência histórica.

## Contas e progresso no GitHub Pages

É possível criar um login para cada funcionário. Os registros, pendências, respostas das aulas e a última seção ou etapa aberta são salvos **separadamente por conta neste navegador e aparelho**. Ao sair e entrar novamente na mesma conta, o guia retoma esse progresso. Entrar em outra conta carrega os dados dessa outra pessoa.

O GitHub Pages publica arquivos estáticos e não executa o servidor de autenticação nem um banco compartilhado. Por isso, as contas locais **não sincronizam entre aparelhos ou navegadores**, e apagar os dados do navegador pode apagar cadastros e progresso. A tela de login local organiza a experiência, mas **não protege informações sensíveis** contra quem tem acesso ao aparelho ou ao armazenamento do site. Evite registrar dados sensíveis de clientes nessa versão. A gestão central de contas da equipe exige um servidor. No Pages, o treinador usa respostas guiadas, sem a API de IA.

## Publicação e desenvolvimento

O workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml), acionado por alterações na branch `main`, instala dependências, audita, verifica código e tipos, compila, executa testes e publica `dist-pages/` no GitHub Pages. `npm run build:github` gera a aplicação React para o caminho `/guia-comercial-mult-portas/`, junto com os arquivos públicos e PDFs. O código e os materiais do site publicado ficam acessíveis a quem visita o repositório ou o endereço do Pages.

Para gerar e visualizar localmente a versão do GitHub Pages, use Node.js `>=22.13.0`:

```bash
npm ci
npm run build:github
npx vite preview --config vite.github.config.ts --host 127.0.0.1
```

Abra o endereço `/guia-comercial-mult-portas/` indicado pelo servidor de prévia. Para executar as verificações locais do projeto, Bash, `curl` e GNU `timeout` também são necessários:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

O repositório mantém também as rotas de API da aplicação com servidor, autenticação e banco D1 para um ambiente com Cloudflare Worker. Esse backend **não roda no GitHub Pages**. Variáveis de servidor não devem ser gravadas no repositório e não são usadas pela versão do Pages.
