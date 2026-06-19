/* =====================================================================
   dashboard.js  —  Painel geral e indicadores por empresa (Chart.js)
   PARE OU SIGA — Conservação | Caminhos da Celulose
   ===================================================================== */

const Dashboard = (() => {
  let charts = {};

  function destruir() {
    Object.values(charts).forEach((c) => c?.destroy());
    charts = {};
  }

  function resumoDe(a) {
    const c = a.itens.filter((i) => i.resultado === "C").length;
    const nc = a.itens.filter((i) => i.resultado === "NC").length;
    const na = a.itens.filter((i) => i.resultado === "NA").length;
    const base = c + nc;
    return { c, nc, na, conformidade: base ? (c / base) * 100 : 0 };
  }

  const CORES = {
    verde: "#1F8A4C", vermelho: "#D6342C", cinza: "#9AA3AD",
    amarelo: "#F2B705", asfalto: "#2A2F36",
  };

  /* ---------------- PAINEL GERAL ---------------- */
  async function painelGeral() {
    destruir();
    const auds = await DB.auditorias.listar();

    let totC = 0, totNC = 0, totNA = 0;
    const porRodovia = {}, porEmpresa = {};
    auds.forEach((a) => {
      const r = resumoDe(a);
      totC += r.c; totNC += r.nc; totNA += r.na;
      porRodovia[a.rodovia] = (porRodovia[a.rodovia] || 0) + 1;
      porEmpresa[a.empresa] = (porEmpresa[a.empresa] || 0) + 1;
    });
    const baseConf = totC + totNC;
    const confGeral = baseConf ? Math.round((totC / baseConf) * 100) : 0;

    $("#view-painel").innerHTML = `
      <header class="topo">
        <button class="btn-voltar" onclick="irPara('home')" aria-label="Voltar">&#8592;</button>
        <h2>Painel geral</h2>
      </header>
      <div class="kpis">
        <div class="kpi"><span class="kpi-num">${auds.length}</span><span class="kpi-lbl">Auditorias</span></div>
        <div class="kpi destaque"><span class="kpi-num">${confGeral}%</span><span class="kpi-lbl">Conformidade</span></div>
        <div class="kpi"><span class="kpi-num vermelho">${totNC}</span><span class="kpi-lbl">Não conf.</span></div>
      </div>
      ${auds.length ? `
        <div class="grafico-box"><h3>Resultado geral</h3><div class="chart-wrap"><canvas id="g-rosca"></canvas></div></div>
        <div class="grafico-box"><h3>Auditorias por rodovia</h3><div class="chart-wrap"><canvas id="g-rodovia"></canvas></div></div>
        <div class="grafico-box"><h3>Auditorias por empresa</h3><div class="chart-wrap" style="height:${Math.max(220, Object.keys(porEmpresa).length * 36 + 40)}px"><canvas id="g-empresa"></canvas></div></div>
      ` : `<div class="vazio">Sem dados ainda. Registre auditorias para ver os indicadores.</div>`}
    `;

    if (!auds.length) return;

    // garante DOM medido antes de criar os charts
    await new Promise((r) => requestAnimationFrame(r));

    charts.rosca = new Chart($("#g-rosca"), {
      type: "doughnut",
      data: {
        labels: ["Conforme", "Não conforme", "Não aplicável"],
        datasets: [{ data: [totC, totNC, totNA], backgroundColor: [CORES.verde, CORES.vermelho, CORES.cinza] }],
      },
      options: baseOpts({ legend: true }),
    });

    charts.rodovia = barChart("#g-rodovia", Object.keys(porRodovia), Object.values(porRodovia), CORES.amarelo);
    charts.empresa = barChart("#g-empresa", Object.keys(porEmpresa), Object.values(porEmpresa), CORES.asfalto, true);
  }

  /* ---------------- INDICADORES POR EMPRESA ---------------- */
  async function indicadoresEmpresa() {
    destruir();
    const auds = await DB.auditorias.listar();
    const empresas = {};
    auds.forEach((a) => {
      const e = (empresas[a.empresa] ||= { qtd: 0, c: 0, nc: 0, na: 0, problemas: {} });
      const r = resumoDe(a);
      e.qtd++; e.c += r.c; e.nc += r.nc; e.na += r.na;
      a.itens.filter((i) => i.resultado === "NC")
        .forEach((i) => (e.problemas[i.item] = (e.problemas[i.item] || 0) + 1));
    });

    const lista = Object.entries(empresas)
      .map(([nome, e]) => {
        const base = e.c + e.nc;
        const conf = base ? Math.round((e.c / base) * 100) : 0;
        const ranking = Object.entries(e.problemas).sort((a, b) => b[1] - a[1]).slice(0, 5);
        return { nome, ...e, conf, ranking };
      })
      .sort((a, b) => a.conf - b.conf); // pior conformidade primeiro

    $("#view-empresas").innerHTML = `
      <header class="topo">
        <button class="btn-voltar" onclick="irPara('home')" aria-label="Voltar">&#8592;</button>
        <h2>Indicadores por empresa</h2>
      </header>
      ${lista.length ? `<div class="grafico-box"><h3>Conformidade por empresa (%)</h3><div class="chart-wrap" style="height:${Math.max(220, lista.length * 36 + 40)}px"><canvas id="g-conf-emp"></canvas></div></div>` : ""}
      <div class="emp-cards">
        ${lista.length ? lista.map(cardEmpresa).join("") : `<div class="vazio">Sem dados ainda.</div>`}
      </div>`;

    if (!lista.length) return;
    await new Promise((r) => requestAnimationFrame(r));

    charts.conf = new Chart($("#g-conf-emp"), {
      type: "bar",
      data: {
        labels: lista.map((l) => l.nome),
        datasets: [{
          data: lista.map((l) => l.conf),
          backgroundColor: lista.map((l) => l.conf >= 90 ? CORES.verde : l.conf >= 70 ? CORES.amarelo : CORES.vermelho),
        }],
      },
      options: { ...baseOpts({ legend: false }), indexAxis: "y", scales: { x: { max: 100, beginAtZero: true } } },
    });
  }

  function cardEmpresa(e) {
    const cor = e.conf >= 90 ? "verde" : e.conf >= 70 ? "amarelo" : "vermelho";
    const ranking = e.ranking.length
      ? `<ol class="rank">${e.ranking.map(([item, n]) => `<li>${item} <span>${n}</span></li>`).join("")}</ol>`
      : `<p class="ok-msg">Sem não conformidades registradas.</p>`;
    return `
      <div class="emp-card">
        <div class="emp-head"><strong>${e.nome}</strong><span class="conf-badge ${cor}">${e.conf}%</span></div>
        <div class="emp-meta">${e.qtd} auditoria(s) • ${e.nc} NC</div>
        <div class="rank-titulo">Principais não conformidades</div>
        ${ranking}
      </div>`;
  }

  /* ---------------- Helpers de gráfico ---------------- */
  function baseOpts({ legend }) {
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: legend, position: "bottom" } },
    };
  }
  function barChart(sel, labels, data, cor, horizontal = false) {
    return new Chart($(sel), {
      type: "bar",
      data: { labels, datasets: [{ data, backgroundColor: cor }] },
      options: {
        ...baseOpts({ legend: false }),
        indexAxis: horizontal ? "y" : "x",
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { precision: 0 } } },
      },
    });
  }

  return { painelGeral, indicadoresEmpresa };
})();
