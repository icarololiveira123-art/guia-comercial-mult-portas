# Recorta Planta para Windows

Aplicativo portátil para Windows 10 e 11 de 64 bits. O executável inclui a interface, o leitor de PDFs, o modelo de OCR e o ambiente de execução. Os PDFs são processados no computador. Não há conta, chave de API ou conexão com o site.

## Uso

1. Abra `Recorta-Planta-Windows.exe`.
2. Clique em **Selecionar PDF** ou use **Ctrl+O**.
3. Confira a planta identificada. Mova a seleção, ajuste os cantos, acrescente margem ou desenhe uma área manual.
4. Clique em **Baixar planta em PDF** e escolha onde salvar.

A identificação é uma sugestão baseada nos títulos e na organização da prancha. Arquivos escaneados precisam de títulos legíveis. Confira as cotas, observações e limites antes de usar o resultado.

## Gerar o executável

Requisitos de desenvolvimento: Node.js 22.12 ou superior e acesso à internet para obter as dependências de compilação. O uso do aplicativo compilado é offline.

```sh
npm ci --ignore-scripts
npm run prepare:web
npm test
npm run dist:win
```

O executável portátil é gerado em `release/Recorta-Planta-Windows.exe`. A geração do pacote não usa certificado de assinatura de código. A versão utiliza Electron 44.7.2 e electron-builder 26.15.3, fixados no arquivo de dependências.

O diretório `app/web` contém a versão local do aplicativo e todos os recursos. `app/main.cjs` abre a janela, cria o protocolo de arquivos local, limita permissões, fornece menus e controla o salvamento. O processo de interface não possui acesso ao Node.js e roda com isolamento e sandbox.

## Licenças

As dependências mantêm suas respectivas licenças. As licenças do leitor de PDF, do OCR e de seus componentes estão em `app/web/vendor/licenses/`. A distribuição também inclui as licenças do Electron e do Chromium.

## Download no Guia Comercial

O acesso fica na página inicial, em **Ferramentas de trabalho → Recorta Planta**. A automação `recorta-planta-desktop.yml` prepara as dependências e o modelo de OCR fixado por hash, testa a interface no Windows, gera e abre o executável portátil, e publica a versão `recorta-planta-v1.0.0` usada pelo botão de download.
