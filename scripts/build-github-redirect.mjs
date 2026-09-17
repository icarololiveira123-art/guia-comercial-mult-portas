import { mkdir, writeFile } from "node:fs/promises";

const productionUrl = "https://guia-comercial-mult-portas.eletrovale-cont.chatgpt.site";
const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#30373d" />
    <meta name="robots" content="noindex, nofollow" />
    <meta http-equiv="refresh" content="0;url=${productionUrl}" />
    <link rel="canonical" href="${productionUrl}" />
    <title>Guia Comercial Mult Portas</title>
    <script>window.location.replace(${JSON.stringify(productionUrl)});</script>
  </head>
  <body>
    <main>
      <p>Abrindo o Guia Comercial Mult Portas…</p>
      <p><a href="${productionUrl}">Clique aqui se o redirecionamento não acontecer.</a></p>
    </main>
  </body>
</html>`;

await mkdir("dist-pages", { recursive: true });
await writeFile("dist-pages/index.html", html, "utf8");
