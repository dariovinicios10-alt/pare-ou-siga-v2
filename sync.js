/* =====================================================================
   sync.js  —  Camada de sincronização (FASE 2 — preparação)
   PARE OU SIGA — Conservação | Caminhos da Celulose

   Não implementa servidor agora. Define o contrato de integração
   com a futura API (Spring Boot / PostgreSQL) da Fase 3.
   ===================================================================== */

const Sync = (() => {
  // Endpoint da futura API. Vazio = modo offline (padrão atual).
  let API_BASE = "";

  function configurar(baseUrl) { API_BASE = baseUrl?.replace(/\/$/, "") || ""; }
  function online() { return Boolean(API_BASE) && navigator.onLine; }

  /* ---------- Serialização das auditorias ---------- */
  async function exportAudits() {
    const auds = await DB.auditorias.listar();
    return auds.map((a) => ({
      idLocal: a.id, status: a.status,
      empresa: a.empresa, rodovia: a.rodovia, km: a.km, sentido: a.sentido,
      servico: a.servico, data: a.data, hora: a.hora,
      divergenciaContratual: !!a.divergenciaContratual,
      itens: a.itens, resumo: a.resumo, concluidoEm: a.concluidoEm,
    }));
  }

  /* ---------- Fotos em base64 (para payload JSON) ---------- */
  async function exportPhotos() {
    const fotos = await DB.fotos.listar();
    const out = [];
    for (const f of fotos) {
      out.push({ idLocal: f.id, auditId: f.auditId, nomeArquivo: f.nomeArquivo, categoria: f.categoria, item: f.item, base64: await blobParaBase64(f.blob) });
    }
    return out;
  }

  /* ---------- Importação (servidor -> dispositivo) ---------- */
  async function importAudits(lista = []) {
    for (const a of lista) { delete a.id; await DB.auditorias.salvar(a); }
    return lista.length;
  }
  async function importPhotos(lista = []) {
    for (const f of lista) {
      await DB.fotos.salvar({ auditId: f.auditId, nomeArquivo: f.nomeArquivo, categoria: f.categoria, item: f.item, blob: base64ParaBlob(f.base64) });
    }
    return lista.length;
  }

  /* ---------- Envio (placeholder — Fase 3) ---------- */
  async function enviarTudo() {
    if (!online()) return { ok: false, motivo: "Sem API configurada ou offline." };
    const payload = { auditorias: await exportAudits(), fotos: await exportPhotos() };
    const resp = await fetch(`${API_BASE}/api/sync`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: resp.ok, status: resp.status };
  }

  /* ---------- Utilitários base64 ---------- */
  function blobParaBase64(blob) {
    return new Promise((res) => { const r = new FileReader(); r.onloadend = () => res(r.result.split(",")[1]); r.readAsDataURL(blob); });
  }
  function base64ParaBlob(b64, tipo = "image/jpeg") {
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: tipo });
  }

  return { configurar, online, exportAudits, exportPhotos, importAudits, importPhotos, enviarTudo };
})();
