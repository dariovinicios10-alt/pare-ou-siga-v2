/* =====================================================================
   sync.js  —  Sincronização com SharePoint (Microsoft Graph API)
   PARE OU SIGA — Conservação | Caminhos da Celulose
   v5 — mapeamento automático de colunas + filtro de read-only
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
  let _fieldMap = null;
  let _syncing = false;

  /* Campos somente-leitura do SharePoint (nunca enviar no POST/PATCH) */
  const READONLY = new Set([
    "LinkTitle", "LinkTitleNoMenu", "_UIVersionString",
    "Edit", "DocIcon", "ItemChildCount", "FolderChildCount",
  ]);

  /* ==========================================================
     RESOLUÇÃO DE IDs DO SHAREPOINT (com cache local)
     ========================================================== */
  async function resolveSiteId(token) {
    if (_siteId) return _siteId;
    const cached = await DB.config.obter("sp_site_id");
    if (cached) { _siteId = cached; return _siteId; }
    const resp = await graphGet("/sites/" + SP_HOST + ":" + SP_SITE_PATH, token);
    _siteId = resp.id;
    await DB.config.salvar("sp_site_id", _siteId);
    return _siteId;
  }

  async function resolveListId(token) {
    if (_listId) return _listId;
    const cached = await DB.config.obter("sp_list_id_ssma");
    if (cached) { _listId = cached; return _listId; }
    const siteId = await resolveSiteId(token);
    const resp = await graphGet("/sites/" + siteId + "/lists/" + encodeURIComponent(LIST_NAME), token);
    _listId = resp.id;
    await DB.config.salvar("sp_list_id_ssma", _listId);
    return _listId;
  }

  async function resolveDriveId(token) {
    if (_driveId) return _driveId;
    var cached = await DB.config.obter("sp_drive_id_fotos_v2");
    if (cached) { _driveId = cached; return _driveId; }

    var siteId = await resolveSiteId(token);

    /* Lista todos os drives do site e encontra pelo nome,
       ignorando ponto ou espaco extra que o SharePoint possa ter adicionado */
    var resp = await graphGet("/sites/" + siteId + "/drives", token);
    var drives = resp.value || [];
    var drive = null;

    for (var i = 0; i < drives.length; i++) {
      var nome = (drives[i].name || "").replace(/[\.\s]+$/, "");
      if (nome === "Fotos_Auditorias" || nome === LIB_NAME) {
        drive = drives[i];
        break;
      }
    }

    if (!drive) {
      console.error("Drives disponiveis:", drives.map(function(d) { return d.name; }));
      throw new Error("Biblioteca de fotos nao encontrada. Drives: " +
        drives.map(function(d) { return d.name; }).join(", "));
    }

    _driveId = drive.id;
    console.log("Drive de fotos encontrado:", drive.name, "->", drive.id);
    await DB.config.salvar("sp_drive_id_fotos_v2", _driveId);
    return _driveId;
  }

  /* ==========================================================
     MAPEAMENTO AUTOMÁTICO DE COLUNAS (display → internal)
     ========================================================== */
  async function resolveFieldMap(token) {
    if (_fieldMap) return _fieldMap;
    const cached = await DB.config.obter("sp_field_map_ssma_v2");
    if (cached) { _fieldMap = cached; return _fieldMap; }

    const siteId = await resolveSiteId(token);
    const listId = await resolveListId(token);
    const resp = await graphGet(
      "/sites/" + siteId + "/lists/" + listId + "/columns?$select=name,displayName,readOnly",
      token
    );

    var map = {};
    (resp.value || []).forEach(function(col) {
      if (col.readOnly) return;
      if (READONLY.has(col.name)) return;
      map[col.displayName] = col.name;
    });
    map["Title"] = "Title";

    console.log("SharePoint field map (limpo):", map);
    _fieldMap = map;
    await DB.config.salvar("sp_field_map_ssma_v2", map);
    return map;
  }

  function mapearCampos(displayFields, fieldMap) {
    var mapped = {};
    for (var key in displayFields) {
      if (!displayFields.hasOwnProperty(key)) continue;
      var valor = displayFields[key];
      if (key === "Title") {
        mapped["Title"] = valor;
        continue;
      }
      var internal = fieldMap[key] || key;
      if (READONLY.has(internal)) {
        console.warn("Campo " + key + " mapeou para " + internal + " (read-only), usando nome original.");
        mapped[key] = valor;
      } else {
        mapped[internal] = valor;
      }
    }
    /* Segurança extra: remove qualquer chave read-only que tenha escapado */
    READONLY.forEach(function(r) { delete mapped[r]; });
    return mapped;
  }

  /* ==========================================================
     HELPERS GRAPH API
     ========================================================== */
  async function graphGet(path, token) {
    var resp = await fetch(GRAPH + path, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!resp.ok) {
      var body = await resp.text().catch(function() { return ""; });
      throw new Error("Graph GET " + path + " -> " + resp.status + ": " + body.slice(0, 300));
    }
    return resp.json();
  }

  async function graphPost(path, body, token) {
    var resp = await fetch(GRAPH + path, {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      var b = await resp.text().catch(function() { return ""; });
      throw new Error("Graph POST " + path + " -> " + resp.status + ": " + b.slice(0, 300));
    }
    return resp.json();
  }

  async function graphPatch(path, body, token) {
    var resp = await fetch(GRAPH + path, {
      method: "PATCH",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      var b = await resp.text().catch(function() { return ""; });
      throw new Error("Graph PATCH " + path + " -> " + resp.status + ": " + b.slice(0, 300));
    }
    return resp.json();
  }

  async function graphPutBinary(path, blob, contentType, token) {
    var resp = await fetch(GRAPH + path, {
      method: "PUT",
      headers: { Authorization: "Bearer " + token, "Content-Type": contentType },
      body: blob,
    });
    if (!resp.ok) {
      var b = await resp.text().catch(function() { return ""; });
      throw new Error("Graph PUT " + path + " -> " + resp.status + ": " + b.slice(0, 300));
    }
    return resp.json();
  }

  /* ==========================================================
     SYNC DE UMA AUDITORIA
     ========================================================== */
  async function syncAuditoria(audit, token) {
    var siteId = await resolveSiteId(token);
    var listId = await resolveListId(token);
    var fieldMap = await resolveFieldMap(token);

    var resumo = audit.resumo || {};
    var camposDisplay = {
      Title: "AUD-" + String(audit.id).padStart(5, "0"),
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

    var fields = mapearCampos(camposDisplay, fieldMap);
    console.log("Enviando campos:", fields);

    if (audit.spItemId) {
      await graphPatch(
        "/sites/" + siteId + "/lists/" + listId + "/items/" + audit.spItemId + "/fields",
        fields, token
      );
    } else {
      var resp = await graphPost(
        "/sites/" + siteId + "/lists/" + listId + "/items",
        { fields: fields }, token
      );
      audit.spItemId = resp.id;
    }

    await syncFotos(audit, token);

    audit.syncStatus = "synced";
    audit.syncedAt = Date.now();
    await DB.auditorias.salvar(audit);
  }

  /* ==========================================================
     SYNC DE FOTOS
     ========================================================== */
  async function syncFotos(audit, token) {
    var fotos = await DB.fotos.porAuditoria(audit.id);
    if (!fotos.length) return;

    var driveId = await resolveDriveId(token);
    var pastaBase = audit.empresa + "/" + audit.data;

    for (var i = 0; i < fotos.length; i++) {
      var foto = fotos[i];
      if (foto.synced) continue;
      if (!foto.blob) continue;

      var nome = foto.nomeArquivo || ("foto_" + foto.id + ".jpg");
      var caminho = encodeURIComponent(pastaBase + "/" + nome).replace(/%2F/g, "/");

      try {
        await graphPutBinary(
          "/drives/" + driveId + "/root:/" + caminho + ":/content",
          foto.blob, "image/jpeg", token
        );
        foto.synced = true;
        await DB.fotos.atualizar(foto);
      } catch (e) {
        console.error("Erro upload foto " + nome + ":", e);
      }
    }
  }

  /* ==========================================================
     SYNC GERAL
     ========================================================== */
  async function syncAll() {
    if (_syncing) return { ok: false, motivo: "Sincronizacao ja em andamento." };
    if (!navigator.onLine) return { ok: false, motivo: "Sem conexao." };

    var token = await Auth.getToken();
    if (!token) return { ok: false, motivo: "Nao autenticado. Faca login primeiro." };

    _syncing = true;
    atualizarIndicadorSync("syncing");

    try {
      var todas = await DB.auditorias.listar();
      var pendentes = todas.filter(function(a) {
        return a.status === "concluida" && a.syncStatus !== "synced";
      });

      var ok = 0;
      var erros = 0;
      for (var i = 0; i < pendentes.length; i++) {
        var audit = pendentes[i];
        try {
          await syncAuditoria(audit, token);
          ok++;
          atualizarIndicadorSync("syncing", ok + "/" + pendentes.length);
        } catch (e) {
          console.error("Sync falhou para auditoria #" + audit.id + ":", e);
          audit.syncStatus = "error";
          audit.syncError = e.message;
          await DB.auditorias.salvar(audit);
          erros++;
        }
      }

      _syncing = false;
      var status = pendentes.length === 0 ? "uptodate" : erros ? "partial" : "done";
      atualizarIndicadorSync(status);
      return { ok: true, sincronizadas: ok, erros: erros, total: pendentes.length };
    } catch (e) {
      _syncing = false;
      atualizarIndicadorSync("error", e.message);
      return { ok: false, motivo: e.message };
    }
  }

  /* ==========================================================
     INDICADOR VISUAL
     ========================================================== */
  function atualizarIndicadorSync(status, detalhe) {
    var el = document.getElementById("sync-status");
    if (!el) return;
    var msgs = {
      syncing: "&#8635; Sincronizando" + (detalhe ? " (" + detalhe + ")" : "..."),
      done: "&#10003; Tudo sincronizado",
      uptodate: "&#10003; Nada pendente",
      partial: "&#9888; Sync parcial — houve erros",
      error: "&#10007; Erro: " + (detalhe || "falha na sincronizacao"),
      offline: "&#8226; Offline — dados salvos localmente",
      pending: "&#8226; Ha auditorias aguardando sync",
    };
    var classes = {
      syncing: "sync-bar syncing", done: "sync-bar ok",
      uptodate: "sync-bar ok", partial: "sync-bar warn",
      error: "sync-bar erro", offline: "sync-bar info",
      pending: "sync-bar info",
    };
    el.innerHTML = msgs[status] || status;
    el.className = classes[status] || "sync-bar";
  }

  /* ==========================================================
     CONTAGEM DE PENDENTES
     ========================================================== */
  async function contarPendentes() {
    var todas = await DB.auditorias.listar();
    return todas.filter(function(a) {
      return a.status === "concluida" && a.syncStatus !== "synced";
    }).length;
  }

  /* ==========================================================
     AUTO-SYNC
     ========================================================== */
  function initAutoSync() {
    window.addEventListener("online", function() {
      if (Auth.isLoggedIn()) {
        atualizarIndicadorSync("syncing");
        setTimeout(syncAll, 2000);
      }
    });
    window.addEventListener("offline", function() {
      atualizarIndicadorSync("offline");
    });
    setInterval(function() {
      if (navigator.onLine && Auth.isLoggedIn() && !_syncing) syncAll();
    }, 5 * 60 * 1000);
  }

  /* ==========================================================
     STATUS INICIAL
     ========================================================== */
  async function verificarStatusInicial() {
    if (!navigator.onLine) { atualizarIndicadorSync("offline"); return; }
    if (!Auth.isLoggedIn()) return;
    var n = await contarPendentes();
    atualizarIndicadorSync(n > 0 ? "pending" : "uptodate");
  }

  /* ==========================================================
     LIMPAR CACHE
     ========================================================== */
  async function limparCache() {
    _siteId = null; _listId = null; _driveId = null; _fieldMap = null;
    await DB.config.salvar("sp_site_id", null);
    await DB.config.salvar("sp_list_id_ssma", null);
    await DB.config.salvar("sp_drive_id_fotos", null);
    await DB.config.salvar("sp_drive_id_fotos_v2", null);
    await DB.config.salvar("sp_field_map_ssma_v2", null);
  }

  return {
    syncAll: syncAll,
    syncAuditoria: syncAuditoria,
    contarPendentes: contarPendentes,
    initAutoSync: initAutoSync,
    verificarStatusInicial: verificarStatusInicial,
    limparCache: limparCache,
    atualizarIndicadorSync: atualizarIndicadorSync,
  };
})();
