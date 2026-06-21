# PARE OU SIGA — Conservação

Aplicativo de auditoria de conservação rodoviária da **Caminhos da Celulose**.
PWA 100% offline, sem servidor e sem custo. Funciona em celular, tablet e computador.

---

## 1. Onde colocar os arquivos

Extraia todo o conteúdo dentro de:

```
C:\Users\DárioViniciusBelchio\Documents\AUDITORIA APP
```

Estrutura final:

```
AUDITORIA APP\
├── index.html
├── style.css
├── app.js
├── database.js
├── dashboard.js
├── sync.js
├── manifest.json
├── service-worker.js
├── icons\  (icon-192.png, icon-512.png, icon-maskable-512.png)
└── lib\    (chart.umd.js, xlsx.full.min.js, jszip.min.js)
```

> As bibliotecas (Chart.js, SheetJS, JSZip) já estão na pasta `lib`. Não precisa de internet.

---

## 2. Como executar (importante)

O app **não roda abrindo o `index.html` direto** (clique duplo), porque o
Service Worker e o banco IndexedDB exigem um endereço `http://localhost`.
Use **uma** das opções abaixo:

### Opção A — VS Code (recomendado p/ testar)
1. Instale a extensão **Live Server**.
2. Abra a pasta `AUDITORIA APP` no VS Code.
3. Clique com o botão direito no `index.html` → **Open with Live Server**.

### Opção B — Python (se tiver instalado)
No CMD, dentro da pasta:
```
cd "C:\Users\DárioViniciusBelchio\Documents\AUDITORIA APP"
python -m http.server 8080
```
Acesse: `http://localhost:8080`

### Opção C — GitHub Pages (uso definitivo, online + instalável)
1. Crie o repositório **pare-ou-siga-conservacao** no GitHub.
2. Envie todos os arquivos.
3. Em **Settings → Pages**, defina a branch `main` / pasta `/root`.
4. O link gerado funciona em qualquer celular. No Chrome do celular:
   menu → **Adicionar à tela inicial** → o app instala e roda **offline**.

---

## 3. Como usar

1. **Empresas / Contratos** — configure primeiro o escopo de cada empresa
   (rodovias, trecho KM e serviços). Isso ativa os alertas de divergência
   contratual durante a auditoria.
2. **Nova auditoria** — preencha identificação → checklist dinâmico →
   marque 🟢 Conforme / 🔴 Não Conforme / ⚪ Não Aplicável.
   Itens **Não Conforme** exigem **observação + foto**.
3. **Painel geral / Indicadores por empresa** — gráficos automáticos.
4. **Exportações** — Excel (item a item) e fotos em `.zip`
   no padrão `EMPRESA_RODOVIA_KM_DD-MM-AA_NN.jpg`.

Os dados ficam salvos **no dispositivo** (IndexedDB). Use a exportação para
backup ou para consolidar em outro computador.

---

## 4. Integração Microsoft 365 (SharePoint)

O app sincroniza auditorias e fotos com o SharePoint da Caminhos da Celulose
via Microsoft Graph API. O fluxo é **offline-first**: dados sempre salvam no
dispositivo (IndexedDB) e sincronizam automaticamente quando há conexão.

### 4.1 Redirect URI no Azure Entra ID

No portal [Azure Entra ID → Registros de aplicativo → "Levantamento Rodoviario"](https://entra.microsoft.com):

1. Vá em **Autenticação → Plataformas → Aplicativo de página única (SPA)**.
2. Adicione o URI de redirecionamento do GitHub Pages:
   `https://SEU-USUARIO.github.io/NOME-DO-REPO/`
   (com barra no final).
3. Salve.

### 4.2 Criar a lista "Auditorias_SSMA" no SharePoint

No site `caminhosdacelulose.sharepoint.com/sites/conservacao`:

1. **Conteúdos do site → Nova → Lista → Lista em branco**.
2. Nome: **Auditorias_SSMA**.
3. Crie as colunas abaixo (todas em **Linha de texto única** exceto onde indicado):

| Nome interno       | Tipo                          | Observação                    |
|--------------------|-------------------------------|-------------------------------|
| Title              | (já existe)                   | ID da auditoria (AUD-00001)   |
| Auditor            | Linha de texto                |                               |
| Empresa            | Linha de texto                |                               |
| Rodovia            | Linha de texto                |                               |
| KM                 | Número (2 decimais)           |                               |
| Sentido            | Linha de texto                |                               |
| Servico            | Linha de texto                |                               |
| DataAuditoria      | Linha de texto                | Formato YYYY-MM-DD            |
| Hora               | Linha de texto                |                               |
| Conformidade       | Número (0 decimais)           | Percentual 0–100              |
| QtdConforme        | Número (0 decimais)           |                               |
| QtdNaoConforme     | Número (0 decimais)           |                               |
| QtdNaoAplicavel    | Número (0 decimais)           |                               |
| ItensJSON          | Várias linhas de texto (simples) | JSON completo do checklist |

### 4.3 Criar a biblioteca "Fotos_Auditorias"

1. **Conteúdos do site → Nova → Biblioteca de documentos**.
2. Nome: **Fotos_Auditorias**.
3. Pronto. O app cria pastas automaticamente: `{Empresa}/{YYYY-MM-DD}/`.

### 4.4 Como funciona a sincronização

- **Login**: botão "Entrar com Microsoft" na tela inicial.
- **Auto-sync**: ao salvar uma auditoria, se online e logado, sincroniza
  automaticamente. Também sincroniza a cada 5 min e ao voltar a ficar online.
- **Sync manual**: botão "Sincronizar agora" na tela inicial.
- **Indicadores**: cada auditoria mostra se está pendente, sincronizada ou com erro.
- **Offline total**: se não houver conexão, salva local e sincroniza depois.

### 4.5 Permissões necessárias (já concedidas no App Registration)

- `User.Read` — nome do usuário logado
- `Sites.ReadWrite.All` — leitura/escrita na lista e biblioteca
- `offline_access` — refresh token para sessão persistente
