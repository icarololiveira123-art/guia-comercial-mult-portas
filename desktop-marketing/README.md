# Marketing Diário — Mult Portas

Aplicativo de computador para Windows 10/11 de 64 bits. Usa as contas e o serviço de dados do Guia Comercial Mult Portas. Não altera o site nem requer a instalação do Node.js no computador do usuário.

## Usar

1. Abra `Marketing-Diario-Mult-Portas-1.0.1-Windows.exe`.
2. Entre com o usuário e a senha cadastrados no site.
3. Registre os seis contadores com `+`, `−` ou digitando o número.
4. Clique em **Copiar resumo** e cole no WhatsApp. O texto não inclui a data.

O dia muda à meia-noite de Brasília e começa em zero, mantendo até 366 dias no histórico. **Zerar contadores de hoje** exige confirmação e preserva os outros dias. É possível salvar o resumo como `.txt`.

Depois de carregar uma conta pela primeira vez, os contadores continuam disponíveis sem conexão. Alterações pendentes ficam protegidas no computador e são enviadas ao reconectar. O aplicativo avisa antes de fechar com alterações pendentes. Para sair da conta, sincronize primeiro.

Quando o mesmo contador foi alterado simultaneamente no site e no aplicativo, a sincronização pausa e apresenta os dois valores para uma escolha explícita. As outras áreas do site e o progresso de aprendizado são preservados. O login inicial e a sincronização precisam de internet.

O executável é portátil, não exige privilégios elevados e inclui o runtime. A sessão e os dados locais usam a proteção do Windows (DPAPI), vinculada à conta do sistema; a senha digitada nunca é gravada. Desmarcar **Manter minha conta conectada** mantém a sessão apenas na memória. Dados de contas diferentes ficam separados por ID interno.

## Desenvolvimento

```sh
npm ci
npm test
npm start
npm run build:windows
```

As dependências são fixadas no lockfile. O instalador portátil usa Electron e NSIS; não há serviço local HTTP nem abertura do navegador para executar a interface. O processo da interface é isolado, sem Node.js, com sandbox e política de conteúdo restritiva. As operações de rede e tokens ficam no processo principal. O serviço aceita apenas o endpoint previamente definido e os tokens individuais do usuário.

Os módulos de domínio `app/lib/marketing-daily.mjs` e `app/lib/shared-api-client.mjs` foram reutilizados sem alterações do commit `220845c417eda85c287007ac5f2aaa469f1eefe0` do repositório original. As chamadas de gravação leem a versão mais recente do estado completo, aplicam apenas as alterações de Marketing diário e enviam a revisão original. Conflitos de revisão repetem a leitura, sem substituir os outros dados.

Os testes usam contas e serviço em memória. O modo de teste da interface está condicionado a `!app.isPackaged` e não pode ativar um serviço alternativo no executável distribuído.

O aplicativo não contém chaves privadas ou chaves de serviço. O arquivo é distribuído sem certificado comercial de assinatura de código.
