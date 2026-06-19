/* =====================================================================
   app.js  —  Lógica principal, navegação e fluxo de auditoria
   PARE OU SIGA — Conservação | Caminhos da Celulose
   ===================================================================== */

/* ---------- Constantes de domínio ---------- */
const RODOVIAS = ["BR-262", "BR-267", "MS-040", "MS-338", "MS-395"];
const SENTIDOS = ["Crescente", "Decrescente"];
const SERVICOS = ["Roçada", "Multifuncional", "Sinalização e Defensa", "Pavimentação"];

/* Checklist: categorias base (sempre) + específicas por serviço */
const CHECKLIST = {
  base: {
    "EPIs": ["Capacete", "Botina", "Óculos", "Luvas", "Proteção auditiva", "Uniforme refletivo"],
    "Sinalização de obra": ["Cones", "Refletividade dos cones", "Placas", "Bandeiras", "Pare e Siga", "Conformidade DNIT"],
    "Veículos": ["Identificação visual", "Ano do veículo", "Câmera de ré", "Estrobo", "Conservação", "Pneus", "Luzes"],
    "Estrutura": ["Banheiro químico", "Área de vivência", "Água potável", "Técnico de segurança"],
  },
  porServico: {
    "Roçada": { "Roçada": ["Avental", "Caneleira", "Protetor facial", "Saia da roçadeira"] },
    "Multifuncional": { "Multifuncional": ["Seta LED bidirecional"] },
    "Sinalização e Defensa": { "Sinalização e Defensa": ["ACM", "Defensas"] },
    "Pavimentação": {},
  },
};

/* ---------- Estado da auditoria em andamento ---------- */
let estado = null;       // auditoria atual
let fotosTemp = {};      // { "categoria||item": Blob }  fotos ainda não salvas

/* ---------- Utilidades ---------- */
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function hoje() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}
function agora() {
  return new Date().toTimeString().slice(0, 5);
}
function dataBR(iso) {
  if (!iso) return "";
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
function chave(cat, item) { return `${cat}||${item}`; }

function toast(msg, tipo = "ok") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast show ${tipo}`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => (t.className = "toast"), 2600);
}

/* ---------- Navegação entre telas ---------- */
function irPara(view) {
  $$(".view").forEach((v) => v.classList.remove("active"));
  $(`#view-${view}`).classList.add("active");
  window.scrollTo(0, 0);

  if (view === "painel") Dashboard.painelGeral();
  if (view === "empresas") Dashboard.indicadoresEmpresa();
  if (view === "pendentes") listarPendentes();
  if (view === "exportacoes") prepararExportacoes();
}

/* ============================================================
   NOVA AUDITORIA — Etapa 1: identificação
   ============================================================ */
async function novaAuditoria() {
  estado = {
    status: "pendente",
    empresa: "", rodovia: "", km: "", sentido: "",
    servico: "", data: hoje(), hora: agora(),
    criadoEm: Date.now(), itens: [],
  };
  fotosTemp = {};
  await renderEtapaIdentificacao();
  irPara("nova");
}

async function renderEtapaIdentificacao() {
  const empresas = (await DB.empresas.listar()).filter((e) => e.ativo);
  const optEmp = empresas.map((e) => `<option value="${e.nome}">${e.nome}</option>`).join("");
  const optSen = SENTIDOS.map((s) => `<option value="${s}">${s}</option>`).join("");

  $("#view-nova").innerHTML = `
    <header class="topo">
      <button class="btn-voltar" onclick="irPara('home')" aria-label="Voltar">&#8592;</button>
      <h2>Nova auditoria</h2>
    </header>
    <div class="passo-info"><span class="passo-n">1</span> Identificação</div>

    <form id="form-ident" class="form-grid" onsubmit="return false">
      <label>Empresa
        <select id="f-empresa" required>${`<option value="">Selecione…</option>` + optEmp}</select>
      </label>
      <label>Rodovia
        <select id="f-rodovia" required disabled><option value="">Selecione a empresa antes…</option></select>
      </label>
      <label>KM
        <input id="f-km" type="text" inputmode="decimal" placeholder="Ex.: 312,500 ou 312.500" autocomplete="off" required>
        <small class="dica" id="dica-km">Aceita vírgula ou ponto. Será validado contra o trecho contratado.</small>
      </label>
      <label>Sentido
        <select id="f-sentido" required>${`<option value="">Selecione…</option>` + optSen}</select>
      </label>
      <label>Serviço
        <select id="f-servico" required disabled><option value="">Selecione a empresa antes…</option></select>
      </label>
      <div class="form-row-2">
        <label>Data <input id="f-data" type="date" required></label>
        <label>Hora <input id="f-hora" type="time" required></label>
      </div>
      <div id="alerta-contratual" class="alerta" hidden></div>
      <button class="btn-primario" id="btn-iniciar-checklist" type="button" disabled>Iniciar checklist &#8594;</button>
    </form>
  `;

  // pré-preenche data/hora do dispositivo
  $("#f-data").value = estado.data || hoje();
  $("#f-hora").value = estado.hora || agora();
  $("#f-sentido").value = estado.sentido || "";
  $("#f-km").value = estado.km || "";

  // listeners
  $("#f-empresa").addEventListener("change", aplicarFiltrosContratuais);
  $("#form-ident").addEventListener("input", validarContrato);
  $("#form-ident").addEventListener("change", validarContrato);
  $("#btn-iniciar-checklist").addEventListener("click", iniciarChecklist);

  // restaura empresa se voltar do checklist
  if (estado.empresa) {
    $("#f-empresa").value = estado.empresa;
    await aplicarFiltrosContratuais();
  }
}

/* ---- Auto-preenche/filtra Rodovia e Serviço a partir do contrato ---- */
async function aplicarFiltrosContratuais() {
  const nome = $("#f-empresa").value;
  estado.empresa = nome;
  const rodSel = $("#f-rodovia");
  const srvSel = $("#f-servico");

  if (!nome) {
    rodSel.innerHTML = `<option value="">Selecione a empresa antes…</option>`;
    srvSel.innerHTML = `<option value="">Selecione a empresa antes…</option>`;
    rodSel.disabled = true; srvSel.disabled = true;
    $("#dica-km").textContent = "Aceita vírgula ou ponto. Será validado contra o trecho contratado.";
    await validarContrato();
    return;
  }

  const emp = await DB.empresas.obter(nome);
  const rodovias = [...new Set((emp.trechos || []).map((t) => t.rodovia))];
  const servicos = emp.servicos || [];

  // Rodovia: 1 = trava no contrato; N = abre só as contratadas
  if (rodovias.length === 1) {
    rodSel.innerHTML = `<option value="${rodovias[0]}" selected>${rodovias[0]} (contrato)</option>`;
    rodSel.disabled = true;
    estado.rodovia = rodovias[0];
  } else {
    rodSel.innerHTML =
      `<option value="">Selecione…</option>` +
      rodovias.map((r) => `<option value="${r}" ${r === estado.rodovia ? "selected" : ""}>${r}</option>`).join("");
    rodSel.disabled = false;
  }

  // Serviço: idem
  if (servicos.length === 1) {
    srvSel.innerHTML = `<option value="${servicos[0]}" selected>${servicos[0]} (contrato)</option>`;
    srvSel.disabled = true;
    estado.servico = servicos[0];
  } else {
    srvSel.innerHTML =
      `<option value="">Selecione…</option>` +
      servicos.map((s) => `<option value="${s}" ${s === estado.servico ? "selected" : ""}>${s}</option>`).join("");
    srvSel.disabled = false;
  }

  // Dica de KM mostrando trechos válidos
  const rodAtual = rodSel.value;
  if (rodAtual) {
    const trechos = (emp.trechos || []).filter((t) => t.rodovia === rodAtual);
    $("#dica-km").textContent =
      trechos.length
        ? `Trecho contratado em ${rodAtual}: ${trechos.map((t) => `km ${t.kmIni}–${t.kmFim}`).join(" • ")}`
        : `${nome} não tem ${rodAtual} no escopo.`;
  }

  await validarContrato();
}

/* ---- Normaliza "312,500" e "312.500" -> 312.5 ---- */
function normalizarKm(v) {
  if (v == null) return NaN;
  const s = String(v).trim().replace(/\s/g, "").replace(",", ".");
  if (s === "") return NaN;
  return parseFloat(s);
}

/* ---- Validação contratual + libera botão ---- */
async function validarContrato() {
  const box = $("#alerta-contratual");
  const btn = $("#btn-iniciar-checklist");
  if (!box || !btn) return true;

  const nome = $("#f-empresa").value;
  const rod = $("#f-rodovia").value;
  const sen = $("#f-sentido").value;
  const srv = $("#f-servico").value;
  const data = $("#f-data").value;
  const hora = $("#f-hora").value;
  const kmRaw = $("#f-km").value.trim();
  const km = normalizarKm(kmRaw);

  const problemas = [];
  const camposObrig = [nome, rod, sen, srv, data, hora].every(Boolean) && kmRaw !== "";

  if (nome) {
    const emp = await DB.empresas.obter(nome);

    if (srv && emp.servicos?.length && !emp.servicos.includes(srv))
      problemas.push(`Serviço "${srv}" fora do escopo de ${nome}.`);

    if (rod && kmRaw !== "") {
      if (isNaN(km)) {
        problemas.push(`KM "${kmRaw}" não é um número válido.`);
      } else {
        const trechos = (emp.trechos || []).filter((t) => t.rodovia === rod);
        if (!trechos.length) {
          problemas.push(`${nome} não tem ${rod} no escopo contratual.`);
        } else {
          const dentro = trechos.some((t) => km >= (t.kmIni ?? -Infinity) && km <= (t.kmFim ?? Infinity));
          if (!dentro) {
            const faixas = trechos.map((t) => `km ${t.kmIni}–${t.kmFim}`).join(" • ");
            problemas.push(`KM ${km} fora do trecho contratado de ${nome} em ${rod} (${faixas}).`);
          }
        }
      }
    }
  }

  if (problemas.length) {
    box.hidden = false;
    box.className = "alerta alerta-aviso";
    box.innerHTML = `<strong>&#9888; Divergência contratual</strong><ul>${problemas.map((p) => `<li>${p}</li>`).join("")}</ul><small>Corrija para iniciar o checklist.</small>`;
    btn.disabled = true;
    return false;
  }

  box.hidden = true;
  btn.disabled = !camposObrig;
  return camposObrig;
}

/* ============================================================
   NOVA AUDITORIA — Etapa 2: checklist dinâmico
   ============================================================ */
async function iniciarChecklist() {
  // botão só fica habilitado quando validarContrato() devolve true,
  // então aqui só precisamos snapshotar os valores
  estado.empresa = $("#f-empresa").value;
  estado.rodovia = $("#f-rodovia").value;
  estado.km = normalizarKm($("#f-km").value);     // armazena numérico
  estado.kmTxt = $("#f-km").value.trim();          // preserva como digitado
  estado.sentido = $("#f-sentido").value;
  estado.servico = $("#f-servico").value;
  estado.data = $("#f-data").value;
  estado.hora = $("#f-hora").value;
  estado.divergenciaContratual = false;

  // monta itens do checklist
  const cats = { ...CHECKLIST.base, ...(CHECKLIST.porServico[estado.servico] || {}) };
  estado.itens = [];
  for (const [cat, itens] of Object.entries(cats))
    for (const item of itens)
      estado.itens.push({ categoria: cat, item, resultado: null, obs: "", temFoto: false });

  renderChecklist();
}

async function voltarParaIdentificacao() {
  await renderEtapaIdentificacao();
  irPara("nova");
}

function renderChecklist() {
  const cats = [...new Set(estado.itens.map((i) => i.categoria))];
  const blocos = cats.map((cat) => {
    const linhas = estado.itens
      .map((it, idx) => ({ it, idx }))
      .filter((x) => x.it.categoria === cat)
      .map(({ it, idx }) => linhaItem(it, idx))
      .join("");
    return `<section class="cat-bloco"><h3 class="cat-titulo">${cat}</h3>${linhas}</section>`;
  }).join("");

  $("#view-checklist").innerHTML = `
    <header class="topo">
      <button class="btn-voltar" onclick="voltarParaIdentificacao()" aria-label="Voltar">&#8592;</button>
      <h2>Checklist</h2>
    </header>
    <div class="ctx-barra">
      <span>${estado.empresa}</span><span>${estado.rodovia} • KM ${estado.km}</span><span>${estado.servico}</span>
    </div>
    <div id="checklist-itens">${blocos}</div>
    <div class="rodape-fixo">
      <div id="progresso-resumo" class="progresso-resumo"></div>
      <button class="btn-primario" onclick="concluirAuditoria()">Concluir auditoria</button>
    </div>
  `;
  atualizarProgresso();
  irPara("checklist");
}

function linhaItem(it, idx) {
  const sel = (r) => (it.resultado === r ? "sel" : "");
  const ehNC = it.resultado === "NC";
  const detalheStyle = ehNC ? "" : "style=\"display:none\"";
  return `
    <div class="item" data-idx="${idx}">
      <div class="item-nome">${it.item}</div>
      <div class="sinais">
        <button type="button" class="sinal verde ${sel("C")}"   onclick="marcar(${idx},'C')"  aria-label="Conforme">&#10003;</button>
        <button type="button" class="sinal vermelho ${sel("NC")}" onclick="marcar(${idx},'NC')" aria-label="Não conforme">&#10007;</button>
        <button type="button" class="sinal cinza ${sel("NA")}"  onclick="marcar(${idx},'NA')" aria-label="Não aplicável">&#8211;</button>
      </div>
      <div class="detalhe-nc" ${detalheStyle}>
        <textarea placeholder="Observação obrigatória…" oninput="setObs(${idx}, this.value)">${it.obs || ""}</textarea>
        <label class="foto-btn ${it.temFoto ? "tem-foto" : ""}">
          ${it.temFoto ? "&#128247; Foto anexada (tocar para trocar)" : "&#128247; Anexar foto (obrigatória)"}
          <input type="file" accept="image/*" capture="environment" onchange="anexarFoto(${idx}, this)" hidden>
        </label>
      </div>
    </div>`;
}

function marcar(idx, resultado) {
  estado.itens[idx].resultado = resultado;
  if (resultado !== "NC") { estado.itens[idx].obs = ""; estado.itens[idx].temFoto = false; delete fotosTemp[chaveDoItem(idx)]; }
  // re-render apenas a linha
  const div = $(`.item[data-idx="${idx}"]`);
  div.outerHTML = linhaItem(estado.itens[idx], idx);
  atualizarProgresso();
}
function chaveDoItem(idx) { const it = estado.itens[idx]; return chave(it.categoria, it.item); }
function setObs(idx, v) { estado.itens[idx].obs = v.trim(); }

async function anexarFoto(idx, input) {
  const file = input.files?.[0];
  if (!file) return;
  // comprime para caber no IndexedDB / acelerar export
  const blob = await comprimirImagem(file, 1280, 0.7);
  fotosTemp[chaveDoItem(idx)] = blob;
  estado.itens[idx].temFoto = true;
  const div = $(`.item[data-idx="${idx}"]`);
  div.outerHTML = linhaItem(estado.itens[idx], idx);
  toast("Foto anexada.");
}

function comprimirImagem(file, maxLado, qualidade) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxLado) {
        const r = maxLado / Math.max(w, h);
        w = Math.round(w * r); h = Math.round(h * r);
      }
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = h;
      cv.getContext("2d").drawImage(img, 0, 0, w, h);
      cv.toBlob((b) => resolve(b || file), "image/jpeg", qualidade);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}

function calcularResumo() {
  const total = estado.itens.length;
  const conforme = estado.itens.filter((i) => i.resultado === "C").length;
  const naoConforme = estado.itens.filter((i) => i.resultado === "NC").length;
  const naoAplicavel = estado.itens.filter((i) => i.resultado === "NA").length;
  const respondidos = conforme + naoConforme + naoAplicavel;
  const baseConf = conforme + naoConforme; // NA não entra no índice
  const conformidade = baseConf ? Math.round((conforme / baseConf) * 100) : 0;
  return { total, conforme, naoConforme, naoAplicavel, respondidos, conformidade };
}

function atualizarProgresso() {
  const r = calcularResumo();
  const el = $("#progresso-resumo");
  if (!el) return;
  el.innerHTML = `
    <span class="chip">${r.respondidos}/${r.total}</span>
    <span class="chip verde">${r.conforme} C</span>
    <span class="chip vermelho">${r.naoConforme} NC</span>
    <span class="chip cinza">${r.naoAplicavel} NA</span>
    <span class="chip destaque">${r.conformidade}%</span>`;
}

/* ---------- Concluir e salvar ---------- */
async function concluirAuditoria() {
  // validações
  const semResposta = estado.itens.filter((i) => !i.resultado);
  if (semResposta.length) { toast(`Há ${semResposta.length} item(ns) sem resposta.`, "erro"); return; }

  for (let idx = 0; idx < estado.itens.length; idx++) {
    const it = estado.itens[idx];
    if (it.resultado === "NC") {
      if (!it.obs) { toast(`Observação obrigatória em: ${it.item}`, "erro"); return; }
      if (!it.temFoto) { toast(`Foto obrigatória em: ${it.item}`, "erro"); return; }
    }
  }

  estado.resumo = calcularResumo();
  estado.status = "concluida";
  estado.concluidoEm = Date.now();

  const id = await DB.auditorias.salvar(estado);

  // persiste fotos vinculadas (numeração sequencial por auditoria)
  let nSeq = 0;
  for (let idx = 0; idx < estado.itens.length; idx++) {
    const it = estado.itens[idx];
    const blob = fotosTemp[chaveDoItem(idx)];
    if (blob) {
      nSeq++;
      await DB.fotos.salvar({
        auditId: id, blob,
        categoria: it.categoria, item: it.item,
        nomeArquivo: nomeArquivoFoto(estado, nSeq),
      });
    }
  }

  toast("Auditoria salva com sucesso.");
  estado = null; fotosTemp = {};
  irPara("home");
}

function nomeArquivoFoto(a, n) {
  const emp = String(a.empresa).toUpperCase().replace(/\s+/g, "-");
  const km = String(a.km).replace(/\./g, "_");
  const [aa, mm, dd] = a.data.split("-");
  const nn = String(n).padStart(2, "0");
  return `${emp}_${a.rodovia}_${km}_${dd}-${mm}-${aa.slice(2)}_${nn}.jpg`;
}

/* ============================================================
   AUDITORIAS PENDENTES / CONCLUÍDAS — listagem
   ============================================================ */
async function listarPendentes() {
  const todas = (await DB.auditorias.listar()).sort((a, b) => b.criadoEm - a.criadoEm);
  const el = $("#lista-auditorias");
  if (!todas.length) {
    el.innerHTML = `<div class="vazio">Nenhuma auditoria registrada ainda.<br><button class="btn-link" onclick="novaAuditoria()">Iniciar a primeira</button></div>`;
    return;
  }
  el.innerHTML = todas.map((a) => {
    const r = a.resumo || calcularResumoDe(a);
    const flag = a.divergenciaContratual ? `<span class="tag-flag">&#9888; contrato</span>` : "";
    return `
      <div class="card-aud">
        <div class="card-head">
          <strong>${a.empresa}</strong>
          <span class="conf-badge ${corConformidade(r.conformidade)}">${r.conformidade}%</span>
        </div>
        <div class="card-meta">${a.rodovia} • KM ${a.km} • ${a.sentido} • ${a.servico}</div>
        <div class="card-meta">${dataBR(a.data)} ${a.hora} ${flag}</div>
        <div class="card-mini">
          <span class="chip verde">${r.conforme}C</span>
          <span class="chip vermelho">${r.naoConforme}NC</span>
          <span class="chip cinza">${r.naoAplicavel}NA</span>
        </div>
        <div class="card-acoes">
          <button class="btn-mini" onclick="verAuditoria(${a.id})">Ver</button>
          <button class="btn-mini perigo" onclick="excluirAuditoria(${a.id})">Excluir</button>
        </div>
      </div>`;
  }).join("");
}

function calcularResumoDe(a) {
  const total = a.itens.length;
  const c = a.itens.filter((i) => i.resultado === "C").length;
  const nc = a.itens.filter((i) => i.resultado === "NC").length;
  const na = a.itens.filter((i) => i.resultado === "NA").length;
  const base = c + nc;
  return { total, conforme: c, naoConforme: nc, naoAplicavel: na, conformidade: base ? Math.round((c / base) * 100) : 0 };
}
function corConformidade(p) { return p >= 90 ? "verde" : p >= 70 ? "amarelo" : "vermelho"; }

async function excluirAuditoria(id) {
  if (!confirm("Excluir esta auditoria e suas fotos? Esta ação não pode ser desfeita.")) return;
  await DB.auditorias.excluir(id);
  toast("Auditoria excluída.");
  listarPendentes();
}

async function verAuditoria(id) {
  const a = await DB.auditorias.obter(id);
  const fotos = await DB.fotos.porAuditoria(id);
  const r = a.resumo || calcularResumoDe(a);
  const fotoPorItem = {};
  fotos.forEach((f) => (fotoPorItem[chave(f.categoria, f.item)] = f));

  const cats = [...new Set(a.itens.map((i) => i.categoria))];
  const corpo = cats.map((cat) => {
    const linhas = a.itens.filter((i) => i.categoria === cat).map((i) => {
      const cor = i.resultado === "C" ? "verde" : i.resultado === "NC" ? "vermelho" : "cinza";
      const lbl = i.resultado === "C" ? "Conforme" : i.resultado === "NC" ? "Não conforme" : "N/A";
      const f = fotoPorItem[chave(i.categoria, i.item)];
      const img = f ? `<img class="thumb" src="${URL.createObjectURL(f.blob)}" alt="foto">` : "";
      const obs = i.obs ? `<div class="ver-obs">${i.obs}</div>` : "";
      return `<div class="ver-item"><span class="ver-nome">${i.item}</span><span class="ver-res ${cor}">${lbl}</span>${obs}${img}</div>`;
    }).join("");
    return `<h4 class="ver-cat">${cat}</h4>${linhas}`;
  }).join("");

  $("#view-detalhe").innerHTML = `
    <header class="topo">
      <button class="btn-voltar" onclick="irPara('pendentes')" aria-label="Voltar">&#8592;</button>
      <h2>Detalhe da auditoria</h2>
    </header>
    <div class="det-cab">
      <strong>${a.empresa}</strong>
      <div class="card-meta">${a.rodovia} • KM ${a.km} • ${a.sentido} • ${a.servico}</div>
      <div class="card-meta">${dataBR(a.data)} ${a.hora}</div>
      <div class="card-mini">
        <span class="chip verde">${r.conforme}C</span>
        <span class="chip vermelho">${r.naoConforme}NC</span>
        <span class="chip cinza">${r.naoAplicavel}NA</span>
        <span class="chip destaque">${r.conformidade}%</span>
      </div>
    </div>
    <div class="ver-corpo">${corpo}</div>`;
  irPara("detalhe");
}

/* ============================================================
   EXPORTAÇÕES — Excel (SheetJS) e Fotos (JSZip)
   ============================================================ */
async function prepararExportacoes() {
  const todas = await DB.auditorias.listar();
  $("#exp-info").innerHTML = `${todas.length} auditoria(s) armazenada(s) no dispositivo.`;
}

async function exportarExcel() {
  try {
    const todas = await DB.auditorias.listar();
    if (!todas.length) { toast("Nada para exportar.", "erro"); return; }

    const linhas = [];
    todas.forEach((a) => {
      a.itens.forEach((i) => {
        linhas.push({
          Data: dataBR(a.data), Hora: a.hora, Empresa: a.empresa, Rodovia: a.rodovia,
          KM: a.kmTxt || a.km, Sentido: a.sentido, Serviço: a.servico,
          Categoria: i.categoria, Item: i.item,
          Resultado: i.resultado === "C" ? "Conforme" : i.resultado === "NC" ? "Não Conforme" : "Não Aplicável",
          Observação: i.obs || "",
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(linhas);
    ws["!cols"] = [{ wch: 11 }, { wch: 6 }, { wch: 18 }, { wch: 9 }, { wch: 10 }, { wch: 12 }, { wch: 18 }, { wch: 18 }, { wch: 22 }, { wch: 14 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Auditorias");

    // Gera blob explicitamente e baixa via <a> ancorado ao DOM (mais compatível)
    const bin = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([bin], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    baixarBlob(blob, `auditorias_${hoje()}.xlsx`);
    toast("Excel exportado.");
  } catch (e) {
    console.error("Erro ao exportar Excel:", e);
    toast("Erro ao exportar Excel: " + (e.message || e), "erro");
  }
}

async function exportarFotos() {
  try {
    const fotos = await DB.fotos.listar();
    if (!fotos.length) { toast("Nenhuma foto para exportar.", "erro"); return; }
    const zip = new JSZip();
    const usados = {};
    fotos.forEach((f, i) => {
      let nome = f.nomeArquivo || `foto_${i + 1}.jpg`;
      if (usados[nome]) {
        const base = nome.replace(/\.jpg$/i, "");
        nome = `${base}_a${f.auditId}.jpg`;
      }
      usados[nome] = true;
      zip.file(nome, f.blob);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    baixarBlob(blob, `fotos_${hoje()}.zip`);
    toast("Fotos exportadas.");
  } catch (e) {
    console.error("Erro ao exportar fotos:", e);
    toast("Erro ao exportar fotos: " + (e.message || e), "erro");
  }
}

function baixarBlob(blob, nome) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch (_) {}
    URL.revokeObjectURL(url);
  }, 1500);
}

/* ============================================================
   CONFIGURAÇÃO DE EMPRESAS (mapeamento contratual)
   ============================================================ */
async function abrirConfigEmpresas() {
  const empresas = await DB.empresas.listar();
  const corpo = empresas.map((e) => `
    <div class="cfg-emp">
      <label class="cfg-titulo">
        <input type="checkbox" ${e.ativo ? "checked" : ""} onchange="cfgAtivo('${e.nome.replace(/'/g, "\\'")}', this.checked)">
        <strong>${e.nome}</strong>
      </label>
      <div class="cfg-info">
        <div class="cfg-rotulo">Serviços contratados</div>
        <div>${(e.servicos || []).join(", ") || "&mdash;"}</div>
        <div class="cfg-rotulo">Trechos contratados</div>
        <ul class="trechos-lista">
          ${(e.trechos || []).map((t) => `<li><strong>${t.rodovia}</strong> &nbsp;km ${t.kmIni} &ndash; ${t.kmFim}</li>`).join("") || "<li>&mdash;</li>"}
        </ul>
      </div>
    </div>`).join("");

  $("#view-config").innerHTML = `
    <header class="topo">
      <button class="btn-voltar" onclick="irPara('home')" aria-label="Voltar">&#8592;</button>
      <h2>Empresas / Contratos</h2>
    </header>
    <p class="ajuda">Escopo contratual de cada empresa. As auditorias usam estes dados para alertar e <strong>bloquear o início</strong> em caso de divergência (Empresa × Rodovia × Trecho × Serviço).</p>
    <div class="cfg-lista">${corpo}</div>`;
  irPara("config");
}

async function cfgAtivo(nome, ativo) {
  const e = await DB.empresas.obter(nome);
  e.ativo = ativo;
  await DB.empresas.salvar(e);
  toast("Configuração salva.");
}

/* ============================================================
   INICIALIZAÇÃO
   ============================================================ */
async function init() {
  await DB.open();
  await DB.seed();

  // registra service worker
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./service-worker.js"); } catch (e) { /* offline ok */ }
  }

  // botões da home
  $("#home-nova")?.addEventListener("click", novaAuditoria);
  $("#home-painel")?.addEventListener("click", () => irPara("painel"));
  $("#home-empresas")?.addEventListener("click", () => irPara("empresas"));
  $("#home-pendentes")?.addEventListener("click", () => irPara("pendentes"));
  $("#home-export")?.addEventListener("click", () => irPara("exportacoes"));
  $("#home-config")?.addEventListener("click", abrirConfigEmpresas);

  irPara("home");
}

document.addEventListener("DOMContentLoaded", init);
