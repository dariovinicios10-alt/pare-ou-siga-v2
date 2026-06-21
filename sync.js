/* =====================================================================
   sync.js  —  Sincronização com SharePoint (Microsoft Graph API)
   PARE OU SIGA — Conservação | Caminhos da Celulose

   - Lista: "Auditorias_SSMA" (colunas documentadas no README)
   - Biblioteca: "Fotos_Auditorias" (fotos organizadas em pastas)
   - IndexedDB continua como storage primário (offline-first)
   - Sync automático quando fica online + autenticado
   ===================================================================== */

const Sync = (() => {
  const SP_HOST = "caminhosdacelulose.sharepoint.com";
  const SP_SITE_PATH = "/sites/conservacao";
  const LIST_NAME = "Auditorias_SSMA";
  const LIB_NAME = "Fotos_Auditorias";
  const GRAPH = "https://graph.microsoft.com/v1.0";

  let _siteId = null;
  let _listId = null;
  let _driveId = null;
  let _syncing = false;

  /* ==========================================================
     RESOLUÇÃO DE IDs DO SHAREPOINT (com cache em config)
     ========================================================== */
  async function resolveSiteId(token) {
    if (_siteId) return _siteId;
    const cached = await DB.config.obter("sp_site_id");
    if (cached) { _siteId = cached; return _siteId; }

    const resp = await graphGet(`/sites/${SP_HOST}:${SP_SITE_PATH}`, token);
    _siteId = resp.id;
    await DB.config.salvar("sp_site_id", _siteId);
    return _siteId;
  }

  async function resolveListId(token) {
    if (_listId) return _listId;
    const cached = await DB.config.obter("sp_list_id_ssma");
    if (cached) { _listId = cached; return _listId; }

    const siteId = await resolveSiteId(token);
    const resp = await graphGet(`/sites/${siteId}/lists/${encodeURIComponent(LIST_NAME)}`, token);
    _listId = resp.id;
    await DB.config.salvar("sp_list_id_ssma", _listId);
    return _listId;
  }

  async function resolveDriveId(token) {
    if (_driveId) return _driveId;
    const cached = await DB.config.obter("sp_drive_id_fotos");
    if (cached) { _driveId = cached; return _driveId; }

    const siteId = await resolveSiteId(token);
    const resp = await graphGet(`/sites/${siteId}/lists/${encodeURIComponent(LIB_NAME)}/drive`, token);
    _driveId = resp.id;
    await DB.config.salvar("sp_drive_id_fotos", _driveId);
    return _driveId;
  }

  /* ==========================================================
     HELPERS GRAPH API
     ========================================================== */
  async function graphGet(path, token) {
    const resp = await fetch(`${GRAPH}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Graph GET ${path} → ${resp.status}: ${body.slice(0, 200)}`);
    }
    return resp.json();
  }

  async function graphPost(path, body, token) {
    const resp = await fetch(`${GRAPH}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const b = await resp.text().catch(() => "");
      throw new Error(`Graph POST ${path} → ${resp.status}: ${b.slice(0, 200)}`);
    }
    return resp.json();
  }

  async function graphPatch(path, body, token) {
    const resp = await fetch(`${GRAPH}${path}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const b = await resp.text().catch(() => "");
      throw new Error(`Graph PATCH ${path} → ${resp.status}: ${b.slice(0, 200)}`);
    }
    return resp.json();
  }

  async function graphPutBinary(path, blob, contentType, token) {
    const resp = await fetch(`${GRAPH}${path}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
      body: blob,
    });
    if (!resp.ok) {
      const b = await resp.text().catch(() => "");
      throw new Error(`Graph PUT ${path} → ${resp.status}: ${b.slice(0, 200)}`);
    }
    return resp.json();
  }

  /* ==========================================================
     SYNC DE UMA AUDITORIA
     ========================================================== */
  async function syncAuditoria(audit, token) {
    const siteId = await resolveSiteId(token);
    const listId = await resolveListId(token);

    const resumo = audit.resumo || {};
    const fields = {
      Title: `AUD-${String(audit.id).padStart(5, "0")}`,
      Auditor: audit.auditor || "",
      Empresa: audit.empresa || "",
      Rodovia: audit.rodovia || "",
      KM: Number(audit.km) || 0,
      Sentido: audit.sentido || "",
      Servico: audit.servico || "",
      DataAuditoria: audit.data || "",
      Hora: audit.hora || "",
      Conformidade: resumo.conformidade || 0,
      QtdConforme: resumo.conforme || 0,
      QtdNaoConforme: resumo.naoConforme || 0,
      QtdNaoAplicavel: resumo.naoAplicavel || 0,
      ItensJSON: JSON.stringify(audit.itens || []),
    };

    if (audit.spItemId) {
      // Atualiza registro existente
      await graphPatch(
        `/sites/${siteId}/lists/${listId}/items/${audit.spItemId}/fields`,
        fields, token
      );
    } else {
      // Cria registro novo
      const resp = await graphPost(
        `/sites/${siteId}/lists/${listId}/items`,
        { fields }, token
      );
      audit.spItemId = resp.id;
    }

    // Upload de fotos
    await syncFotos(audit, token);

    // Marca como sincronizado
    audit.syncStatus = "synced";
    audit.syncedAt = Date.now();
    await DB.auditorias.salvar(audit);
  }

  /* ==========================================================
     SYNC DE FOTOS DE UMA AUDITORIA
     ========================================================== */
  async function syncFotos(audit, token) {
    const fotos = await DB.fotos.porAuditoria(audit.id);
    if (!fotos.length) return;

    const driveId = await resolveDriveId(token);
    const pastaBase = `${audit.empresa}/${audit.data}`;

    for (const foto of fotos) {
      if (foto.synced) continue; // já sincronizada
      if (!foto.blob) continue;  // sem conteúdo

      const nome = foto.nomeArquivo || `foto_${foto.id}.jpg`;
      const caminho = encodeURIComponent(`${pastaBase}/${nome}`).replace(/%2F/g, "/");

      try {
        await graphPutBinary(
          `/drives/${driveId}/root:/${caminho}:/content`,
          foto.blob, "image/jpeg", token
        );
        foto.synced = true;
        await DB.fotos.atualizar(foto);
      } catch (e) {
        console.error(`Erro upload foto ${nome}:`, e);
        // Não interrompe o sync das demais
      }
    }
  }

  /* ==========================================================
     SYNC GERAL (todas as auditorias pendentes)
     ========================================================== */
  async function syncAll() {
    if (_syncing) return { ok: false, motivo: "Sincronização já em andamento." };
    if (!navigator.onLine) return { ok: false, motivo: "Sem conexão." };

    const token = await Auth.getToken();
    if (!token) return { ok: false, motivo: "Não autenticado. Faça login primeiro." };

    _syncing = true;
    atualizarIndicadorSync("syncing");

    try {
      const todas = await DB.auditorias.listar();
      const pendentes = todas.filter(
        (a) => a.status === "concluida" && a.syncStatus !== "synced"
      );

      let ok = 0, erros = 0;
      for (const audit of pendentes) {
        try {
          await syncAuditoria(audit, token);
          ok++;
          atualizarIndicadorSync("syncing", `${ok}/${pendentes.length}`);
        } catch (e) {
          console.error(`Sync falhou para auditoria #${audit.id}:`, e);
          audit.syncStatus = "error";
          audit.syncError = e.message;
          await DB.auditorias.salvar(audit);
          erros++;
        }
      }

      _syncing = false;
      const status = pendentes.length === 0 ? "uptodate" : erros ? "partial" : "done";
      atualizarIndicadorSync(status);
      return { ok: true, sincronizadas: ok, erros, total: pendentes.length };
    } catch (e) {
      _syncing = false;
      atualizarIndicadorSync("error", e.message);
      return { ok: false, motivo: e.message };
    }
  }

  /* ==========================================================
     INDICADOR VISUAL DE SYNC
     ========================================================== */
  function atualizarIndicadorSync(status, detalhe) {
    const el = document.getElementById("sync-status");
    if (!el) return;

    const msgs = {
      syncing: `&#8635; Sincronizando${detalhe ? ` (${detalhe})` : "…"}`,
      done: "&#10003; Tudo sincronizado",
      uptodate: "&#10003; Nada pendente",
      partial: "&#9888; Sync parcial — houve erros",
      error: `&#10007; Erro: ${detalhe || "falha na sincronização"}`,
      offline: "&#8226; Offline — dados salvos localmente",
      pending: "&#8226; Há auditorias aguardando sync",
    };
    const classes = {
      syncing: "sync-bar syncing", done: "sync-bar ok",
      uptodate: "sync-bar ok", partial: "sync-bar warn",
      error: "sync-bar erro", offline: "sync-bar info",
      pending: "sync-bar info",
    };

    el.innerHTML = msgs[status] || status;
    el.className = classes[status] || "sync-bar";
  }

  /* ==========================================================
     CONTAGEM DE PENDENTES (para exibir na home)
     ========================================================== */
  async function contarPendentes() {
    const todas = await DB.auditorias.listar();
    return todas.filter(
      (a) => a.status === "concluida" && a.syncStatus !== "synced"
    ).length;
  }

  /* ==========================================================
     AUTO-SYNC (ativado na inicialização)
     ========================================================== */
  function initAutoSync() {
    // Sync quando volta a ficar online
    window.addEventListener("online", () => {
      if (Auth.isLoggedIn()) {
        atualizarIndicadorSync("syncing");
        setTimeout(syncAll, 2000);
      }
    });

    window.addEventListener("offline", () => {
      atualizarIndicadorSync("offline");
    });

    // Sync periódico a cada 5 minutos
    setInterval(() => {
      if (navigator.onLine && Auth.isLoggedIn() && !_syncing) syncAll();
    }, 5 * 60 * 1000);
  }

  /* ==========================================================
     STATUS INICIAL (chamado na inicialização)
     ========================================================== */
  async function verificarStatusInicial() {
    if (!navigator.onLine) {
      atualizarIndicadorSync("offline");
      return;
    }
    if (!Auth.isLoggedIn()) return;

    const n = await contarPendentes();
    if (n > 0) {
      atualizarIndicadorSync("pending");
    } else {
      atualizarIndicadorSync("uptodate");
    }
  }

  /* ==========================================================
     LIMPAR CACHE DE IDs (útil se mudar de site/lista)
     ========================================================== */
  async function limparCache() {
    _siteId = null; _listId = null; _driveId = null;
    await DB.config.salvar("sp_site_id", null);
    await DB.config.salvar("sp_list_id_ssma", null);
    await DB.config.salvar("sp_drive_id_fotos", null);
  }

  return {
    syncAll, syncAuditoria, contarPendentes,
    initAutoSync, verificarStatusInicial, limparCache,
    atualizarIndicadorSync,
  };
})();
