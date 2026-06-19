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

## 4. Fase 2 / Fase 3 (futuro)

`sync.js` já define o contrato de integração com a futura API
**Spring Boot + PostgreSQL** (`exportAudits`, `exportPhotos`, `importAudits`,
`importPhotos`, `enviarTudo`). Basta chamar `Sync.configurar("https://sua-api")`
quando o servidor existir. Nada disso é necessário agora.
