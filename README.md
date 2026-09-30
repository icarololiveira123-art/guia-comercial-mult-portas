# Guia Comercial Mult Portas

Catálogos comerciais e aulas para quem está começando a trabalhar com portas e esquadrias.

**Site público:** [icarololiveira123-art.github.io/guia-comercial-mult-portas](https://icarololiveira123-art.github.io/guia-comercial-mult-portas/).

## O que funciona no GitHub Pages

- Fichas comerciais pesquisáveis por marca e família, com perguntas de conferência antes da cotação.
- Trilhas de aprendizado para nove marcas: materiais, medidas, avaliação de qualidade, casos práticos e perguntas com explicação.
- Cinco catálogos Brimak em PDF, cada um com roteiro de estudo por página e exercício.
- Glossário e método para separar medidas da folha, do conjunto e do vão acabado.
- Progresso dos exercícios salvo somente no navegador do dispositivo usado. Não há conta, login, certificado nem sincronização entre aparelhos.

As aulas são material de estudo. Especificações, composição, medidas, disponibilidade, instalação, desempenho e garantia devem ser confirmados no código e na ficha vigente do fabricante. Não existe uma folga de instalação universal. O catálogo geral Brimak de 2018 é uma referência histórica.

## Publicação no GitHub

O workflow `.github/workflows/pages.yml` executa verificações, roda `npm run build:github` e publica `dist-pages/` no GitHub Pages. Esse diretório contém apenas HTML, CSS, JavaScript, os dados públicos dos catálogos e os cinco PDFs. O site usa caminhos relativos para funcionar no endereço do projeto (`/guia-comercial-mult-portas/`). O domínio público é o próprio `github.io`; não é necessário comprar domínio.

Para gerar e visualizar a versão pública localmente:

```bash
npm run build:github
cd dist-pages
python3 -m http.server 8000
```

Abra `http://localhost:8000/`. Para testar com o mesmo prefixo do GitHub Pages, sirva o diretório como `/guia-comercial-mult-portas/`.

## Código da aplicação interna

O repositório também contém uma aplicação Next.js/React com APIs, autenticação, dados individuais e treinador de conversas. Ela depende de um servidor Cloudflare Worker, banco D1 e variáveis de ambiente. **Esse código não é executado pelo GitHub Pages**; não há login ou persistência de equipe na versão pública.

Para desenvolver e validar esse código separadamente, são necessários Node.js `>=22.13.0`, Bash, `curl` e GNU `timeout`:

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run test:e2e
```

As variáveis do servidor, como `ADMIN_PASSWORD` e a opcional `OPENAI_API_KEY`, nunca devem ser gravadas no repositório. Nenhuma delas é usada no site estático publicado.
