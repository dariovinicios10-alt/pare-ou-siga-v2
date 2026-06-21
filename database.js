/* =====================================================================
   database.js  —  Camada de dados (IndexedDB)
   PARE OU SIGA — Conservação | Caminhos da Celulose
   Funciona 100% offline. Sem servidor.
   ===================================================================== */

const DB = (() => {
  const DB_NAME = "pare_ou_siga_db";
  const DB_VERSION = 1;
  let _db = null;

  /* ---------- Abertura / criação do banco ---------- */
  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;

        if (!db.objectStoreNames.contains("auditorias")) {
          const s = db.createObjectStore("auditorias", { keyPath: "id", autoIncrement: true });
          s.createIndex("empresa", "empresa", { unique: false });
          s.createIndex("rodovia", "rodovia", { unique: false });
          s.createIndex("status", "status", { unique: false });
          s.createIndex("data", "data", { unique: false });
        }

        if (!db.objectStoreNames.contains("fotos")) {
          const s = db.createObjectStore("fotos", { keyPath: "id", autoIncrement: true });
          s.createIndex("auditId", "auditId", { unique: false });
        }

        if (!db.objectStoreNames.contains("empresas")) {
          db.createObjectStore("empresas", { keyPath: "nome" });
        }

        if (!db.objectStoreNames.contains("config")) {
          db.createObjectStore("config", { keyPath: "chave" });
        }
      };

      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  /* ---------- Helpers genéricos de transação ---------- */
  function tx(store, mode = "readonly") {
    return _db.transaction(store, mode).objectStore(store);
  }
  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function put(store, value) {
    await open();
    return reqToPromise(tx(store, "readwrite").put(value));
  }
  async function add(store, value) {
    await open();
    return reqToPromise(tx(store, "readwrite").add(value));
  }
  async function get(store, key) {
    await open();
    return reqToPromise(tx(store).get(key));
  }
  async function getAll(store) {
    await open();
    return reqToPromise(tx(store).getAll());
  }
  async function del(store, key) {
    await open();
    return reqToPromise(tx(store, "readwrite").delete(key));
  }
  async function getByIndex(store, index, value) {
    await open();
    return reqToPromise(tx(store).index(index).getAll(value));
  }

  /* ---------- Auditorias ---------- */
  const auditorias = {
    salvar: (a) => (a.id ? put("auditorias", a) : add("auditorias", a)),
    obter: (id) => get("auditorias", id),
    listar: () => getAll("auditorias"),
    excluir: async (id) => {
      const fotos = await getByIndex("fotos", "auditId", id);
      await Promise.all(fotos.map((f) => del("fotos", f.id)));
      return del("auditorias", id);
    },
    porStatus: (st) => getByIndex("auditorias", "status", st),
  };

  /* ---------- Fotos (blobs) ---------- */
  const fotos = {
    salvar: (f) => add("fotos", f),
    atualizar: (f) => put("fotos", f),   // usado pelo sync para marcar synced=true
    porAuditoria: (auditId) => getByIndex("fotos", "auditId", auditId),
    listar: () => getAll("fotos"),
    excluir: (id) => del("fotos", id),
  };

  /* ---------- Empresas (configuração contratual) ---------- */
  const empresas = {
    salvar: (e) => put("empresas", e),
    obter: (nome) => get("empresas", nome),
    listar: () => getAll("empresas"),
    excluir: (nome) => del("empresas", nome),
  };

  /* ---------- Config (chave/valor) ---------- */
  const config = {
    salvar: (chave, valor) => put("config", { chave, valor }),
    obter: async (chave) => (await get("config", chave))?.valor,
  };

  /* ---------- Seed inicial (primeira execução) ----------
     Mapeamento contratual oficial da Caminhos da Celulose.
     trechos: cada item define rodovia + km início + km fim contratado. */
  async function seed() {
    await open();
    const jaSemeado = await config.obter("seed_v2");
    if (jaSemeado) return;

    // Trechos de toda a malha (referência reutilizada)
    const MALHA_TODA = [
      { rodovia: "BR-262", kmIni: 0, kmFim: 328.2 },
      { rodovia: "BR-267", kmIni: 0, kmFim: 248.1 },
      { rodovia: "MS-040", kmIni: 0, kmFim: 227 },
      { rodovia: "MS-338", kmIni: 287, kmFim: 346 },
      { rodovia: "MS-395", kmIni: 65, kmFim: 73 },
    ];
    const LOTE_02 = [
      { rodovia: "MS-040", kmIni: 0, kmFim: 227 },
      { rodovia: "MS-338", kmIni: 287, kmFim: 346 },
      { rodovia: "MS-395", kmIni: 65, kmFim: 73 },
    ];

    const contratos = [
      { nome: "Engepar",            servicos: ["Pavimentação"],          trechos: MALHA_TODA },
      { nome: "Ética Construtora",  servicos: ["Roçada"],                trechos: LOTE_02 },
      { nome: "Integração Rodovias",servicos: ["Roçada"],                trechos: [{ rodovia: "BR-262", kmIni: 0, kmFim: 328.2 }] },
      { nome: "DLS",                servicos: ["Roçada"],                trechos: [{ rodovia: "BR-267", kmIni: 0, kmFim: 248.1 }] },
      { nome: "LPM",                servicos: ["Roçada"],                trechos: [{ rodovia: "MS-040", kmIni: 0, kmFim: 50 }] },
      { nome: "GD",                 servicos: ["Multifuncional"],        trechos: MALHA_TODA },
      { nome: "BC2",                servicos: ["Multifuncional"],        trechos: LOTE_02 },
      { nome: "Oracelo",            servicos: ["Multifuncional"],        trechos: [{ rodovia: "BR-262", kmIni: 0, kmFim: 328.2 }] },
      { nome: "Sinario",            servicos: ["Sinalização e Defensa"], trechos: MALHA_TODA },
    ].map((c) => ({ ...c, ativo: true }));

    await Promise.all(contratos.map((e) => empresas.salvar(e)));
    await config.salvar("seed_v2", true);
  }

  return { open, seed, auditorias, fotos, empresas, config };
})();
