// Briefing do painel de controle (link público + token, sem login).
// O token fica no hash (#k=...), então não vai para logs de servidor.
// Quem tem o link só lê e grava as respostas deste formulário, via RPC
// security definer que valida o hash do token no banco.
(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  const token = new URLSearchParams(location.hash.slice(1)).get("k") || "";
  const MAX = 4000;

  // Etapa 1 (respondida)
  const STEP1 = [
    ["q1", "Vocês usam algum sistema contábil hoje (Domínio, Alterdata, Questor ou outro) para emitir guias e declarações? Ele exporta relatórios?"],
    ["q2", "Quantos clientes a Garten atende no total?"],
    ["q3", "Desses, quantos são MEI, quantos são Simples Nacional e quantos são Lucro Presumido ou outro regime?"],
    ["q4", "O faturamento de cada cliente é anotado todo mês na planilha? Em que dia do mês costuma ser atualizado?"],
    ["q5", "Para quantos clientes você emite nota fiscal no lugar deles? Tem um dia fixo por cliente?"],
    ["q6", "Que prazos você acompanha hoje (DAS, DASN-SIMEI, DCTFWeb, folha etc.)? Algum já foi perdido por falta de lembrete?"],
    ["q7", "Quem mais da equipe precisaria acessar o painel? Todos podem ver todos os clientes, ou o acesso precisa ser separado?"],
    ["q8", "Qual é a primeira coisa que você confere quando abre a planilha de manhã?"],
    ["q9", "Dos clientes PJ, quantos sócios também são atendidos por vocês como pessoa física (imposto de renda, carnê-leão etc.)?"],
    ["q10", "Qual erro ou esquecimento mais te custou dinheiro ou dor de cabeça no último ano?"],
    ["q11", "Para ter backup automático e segurança dos dados, a hospedagem do painel custa em torno de R$ 150 por mês. A Garten topa esse custo?"],
  ];

  // Etapa 2
  const SEND = [
    ["q20", "Um exemplo do relatório que o Domínio exporta", "Faturamento por empresa e, se existir, a agenda de obrigações por cliente. Excel ou CSV. Pode trocar nomes e CNPJ por fictícios."],
    ["q21", "A planilha de controle que você usa hoje", "Pode vir com os nomes trocados. Serve para entender a sua rotina."],
    ["q22", "Quais obrigações cada empresa tem", "Quem paga PIS/COFINS, quem tem parcelamento, quem recolhe IRPJ/CSLL. Se o Domínio não exportar, uma lista simples resolve."],
    ["q23", "A lista dos clientes de nota fiscal", "Os cerca de 13 clientes e com que frequência cada um emite."],
    ["q24", "O vínculo entre empresa e sócio", "Qual sócio PF pertence a cada uma das 21 ME, para a temporada de IR."],
  ];
  const ASK = [
    ["q12", "O contrato de vocês com o Domínio inclui acesso à API (ou ao Onvio)? Se não souber, dá para perguntar ao suporte quais dados a API libera?"],
    ["q13", "Você quer receber um aviso por e-mail quando um prazo estiver a 3 dias e ainda houver apuração em aberto?"],
    ["q14", "Se sim, em qual e-mail?"],
    ["q15", "Olhando a prévia do painel abaixo: o que falta, o que sobra ou o que você mudaria?"],
  ];
  const AGREE = [
    ["q30", "Acordo de dados (LGPD)", "O Rapha atua como operador dos dados, com contrato simples de confidencialidade. Os dados ficam sob controle da Garten."],
    ["q31", "Hospedagem no nome da Garten", "A conta paga do banco de dados fica no cartão da Garten, com o Rapha como administrador."],
    ["q32", "Endereço do painel e e-mails", "A equipe do site cria 4 registros de DNS: o endereço do painel e os 3 que permitem enviar e-mails com o nome da Garten. Os valores exatos o Rapha envia."],
  ];

  const gate = (title, text) => app.replaceChildren(el("div", { class: "gate wrap" }, el("h1", {}, title), el("p", {}, text)));

  async function rpc(fn, body) {
    const res = await fetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: cfg.publishableKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(res.status === 400 || res.status === 404 ? "invalid" : "Erro de conexão");
    return json;
  }

  const save = async (key, val, status) => {
    status.textContent = "Salvando…"; status.className = "bf-status";
    try { await rpc("briefing_save", { p_token: token, p_key: key, p_answer: val.slice(0, MAX) }); status.textContent = "Salvo"; status.className = "bf-status ok"; return true; }
    catch { status.textContent = "Não salvou. Tente de novo."; status.className = "bf-status err"; return false; }
  };

  function textField([key, label], num, answers) {
    const id = `ans-${key}`;
    const status = el("span", { class: "bf-status", role: "status", "aria-live": "polite" });
    const ta = el("textarea", { id, rows: 3, maxlength: MAX, placeholder: "Escreva aqui…" });
    ta.value = answers[key] || "";
    let timer = null, last = ta.value;
    const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
    const flush = async () => { if (ta.value !== last && await save(key, ta.value, status)) last = ta.value; };
    ta.addEventListener("input", () => { grow(); clearTimeout(timer); timer = setTimeout(flush, 900); });
    ta.addEventListener("blur", () => { clearTimeout(timer); flush(); });
    requestAnimationFrame(grow);
    return el("li", { class: "bf-item" },
      el("label", { for: id }, el("span", { class: "bf-num" }, String(num).padStart(2, "0")), el("span", {}, label)),
      ta, status);
  }

  function checkField([key, title, desc], onValue, answers) {
    const id = `chk-${key}`;
    const status = el("span", { class: "bf-status", role: "status", "aria-live": "polite" });
    const box = el("input", { type: "checkbox", id, class: "bf-check" });
    box.checked = !!answers[key];
    const row = el("li", { class: "bf-item bf-row" + (box.checked ? " done" : "") },
      box, el("div", {}, el("label", { for: id, class: "bf-row-title" }, title), el("p", { class: "bf-row-desc" }, desc), status));
    box.addEventListener("change", async () => {
      row.classList.toggle("done", box.checked);
      if (!await save(key, box.checked ? onValue : "", status)) { box.checked = !box.checked; row.classList.toggle("done", box.checked); }
    });
    return row;
  }

  const section = (kicker, title, lede, ...body) => el("section", { class: "bf-section" },
    el("p", { class: "bf-kicker" }, kicker), el("h2", { class: "bf-h2" }, title), lede ? el("p", { class: "bf-lede" }, lede) : null, ...body);

  // ---------- Prévia do painel (dados ilustrativos) ----------
  const ROWS = [
    { emp: "Empresa A", reg: "ME", obr: "PGDAS-D", dia: "20/11", st: "warn" },
    { emp: "Empresa B", reg: "MEI", obr: "DAS-MEI", dia: "20/11", st: "todo" },
    { emp: "Empresa C", reg: "Presumido", obr: "PIS/COFINS", dia: "25/11", st: "todo" },
    { emp: "Empresa D", reg: "ME", obr: "PGDAS-D", dia: "20/11", st: "ok" },
    { emp: "Empresa C", reg: "Presumido", obr: "IRPJ/CSLL", dia: "30/11", st: "todo" },
    { emp: "Empresa E", reg: "MEI", obr: "DAS-MEI", dia: "20/11", st: "ok" },
  ];
  const ST = { warn: ["Vence em 3 dias", "pv-pill warn"], todo: ["A fazer", "pv-pill"], ok: ["Apurado", "pv-pill ok"] };

  function preview() {
    let filter = "pend";
    const count = el("strong", {});
    const tbody = el("tbody", {});
    const chips = [];
    const draw = () => {
      const pend = ROWS.filter((r) => r.st !== "ok").length;
      count.textContent = String(pend);
      tbody.replaceChildren(...ROWS.filter((r) => filter === "all" ? true : filter === "pend" ? r.st !== "ok" : r.reg === filter).map((r, i) => {
        const id = `pv-${i}-${r.emp}-${r.obr}`.replace(/\W+/g, "-");
        const box = el("input", { type: "checkbox", id, class: "bf-check" });
        box.checked = r.st === "ok";
        box.addEventListener("change", () => { r.st = box.checked ? "ok" : "todo"; draw(); });
        const [txt, cls] = ST[r.st];
        return el("tr", { class: r.st === "ok" ? "done" : "" },
          el("td", {}, box), el("td", {}, el("label", { for: id, class: "pv-emp" }, r.emp)), el("td", {}, r.reg), el("td", {}, r.obr), el("td", {}, r.dia), el("td", {}, el("span", { class: cls }, txt)));
      }));
      chips.forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.f === filter)));
    };
    const chip = (f, label) => { const b = el("button", { type: "button", class: "pv-chip", "data-f": f, onclick: () => { filter = f; draw(); } }, label); chips.push(b); return b; };

    const node = el("div", { class: "pv", role: "region", "aria-label": "Prévia do painel com dados ilustrativos" },
      el("div", { class: "pv-bar" }, el("span", { class: "pv-tab on" }, "Hoje"), el("span", { class: "pv-tab" }, "Clientes"), el("span", { class: "pv-tab" }, "Prazos"), el("span", { class: "pv-tab" }, "Importar do Domínio")),
      el("div", { class: "pv-body" },
        el("div", { class: "pv-hero" },
          el("div", {}, el("p", { class: "pv-kicker" }, "Competência outubro · apuração em novembro"),
            el("p", { class: "pv-title" }, "Faltam ", count, " ", el("span", { class: "pv-glare" }, "empresas"), el("br", {}), el("span", { class: "pv-indent" }, "para apurar"))),
          el("span", { class: "pv-cta" }, "Importar relatório do Domínio")),
        el("div", { class: "pv-kpis" },
          el("div", { class: "pv-kpi dark" }, el("p", {}, "Apurações pendentes"), el("p", { class: "pv-big neon" }, "4 ", el("small", {}, "de 32"))),
          el("div", { class: "pv-kpi" }, el("p", {}, "Próximo prazo"), el("p", { class: "pv-big" }, "Dia 20"), el("p", { class: "pv-sub" }, "PGDAS e declarações")),
          el("div", { class: "pv-kpi" }, el("p", {}, "Notas a emitir"), el("p", { class: "pv-big" }, "9 de 13"), el("p", { class: "pv-sub" }, "neste mês")),
          el("div", { class: "pv-kpi" }, el("p", {}, "MEIs acima de 80%"), el("p", { class: "pv-big warn" }, "2 de 10"), el("p", { class: "pv-sub" }, "após importar o Domínio"))),
        el("div", { class: "pv-grid" },
          el("div", { class: "pv-card pv-main" },
            el("div", { class: "pv-card-head" }, el("p", { class: "pv-h3" }, "Checklist de apuração"),
              el("div", { class: "pv-chips", role: "group", "aria-label": "Filtrar a prévia" }, chip("pend", "Pendentes"), chip("MEI", "MEI"), chip("ME", "ME"), chip("Presumido", "Presumido"), chip("all", "Todas"))),
            el("div", { class: "pv-scroll" }, el("table", { class: "pv-table" },
              el("thead", {}, el("tr", {}, el("th", { scope: "col" }, el("span", { class: "sr" }, "Feito")), el("th", { scope: "col" }, "Empresa"), el("th", { scope: "col" }, "Regime"), el("th", { scope: "col" }, "Obrigação"), el("th", { scope: "col" }, "Vence"), el("th", { scope: "col" }, "Status"))),
              tbody)),
            el("p", { class: "pv-foot" }, "Marque uma linha para ver como funciona. Na versão real, marcar registra data e hora.")),
          el("div", { class: "pv-side" },
            el("div", { class: "pv-card dark" }, el("p", { class: "pv-h3" }, "Prazos do mês"),
              el("ol", { class: "pv-time" },
                el("li", {}, el("strong", {}, "Dia 20"), el("span", {}, "PGDAS, DAS-MEI e declarações")),
                el("li", {}, el("strong", {}, "Dia 25"), el("span", {}, "PIS/COFINS")),
                el("li", {}, el("strong", {}, "Último dia"), el("span", {}, "Parcelamentos e IRPJ/CSLL")))),
            el("div", { class: "pv-card" }, el("p", { class: "pv-h3" }, "Teto do MEI"),
              el("div", { class: "pv-meter" }, el("p", {}, el("span", {}, "MEI 1"), el("strong", { class: "warn" }, "92%")), el("div", { class: "pv-track" }, el("div", { class: "pv-fill w92" }))),
              el("div", { class: "pv-meter" }, el("p", {}, el("span", {}, "MEI 2"), el("strong", {}, "81%")), el("div", { class: "pv-track" }, el("div", { class: "pv-fill w81" }))))))));
    draw();
    return node;
  }

  async function init() {
    if (token.length !== 48) return gate("Link inválido", "Confira se você abriu o link completo que recebeu.");
    let data;
    try { data = await rpc("briefing_open", { p_token: token }); }
    catch (e) { return e.message === "invalid" ? gate("Link inválido", "Este link expirou ou foi trocado. Peça um novo ao Rapha.") : gate("Sem conexão", "Não foi possível carregar. Tente de novo em instantes."); }
    const answers = (data && data.answers) || {};

    app.replaceChildren(el("div", { class: "wrap bf" },
      el("header", { class: "bf-head" },
        el("p", { class: "bf-kicker" }, "Painel de controle · etapa 2"),
        el("h1", {}, "Obrigado pelas respostas. Agora, os próximos passos."),
        el("p", { class: "bf-lede" }, "Ficou claro que o centro do painel é não deixar nenhuma apuração passar. Abaixo tem uma prévia de como ele vai ficar, o que precisamos receber e alguns combinados. Tudo salva sozinho.")),

      section("Prévia", "Como o painel vai funcionar", "Dados ilustrativos. A tela abre mostrando o que falta apurar no mês.", preview()),

      section("O que enviar", "Arquivos que precisamos", null,
        el("ol", { class: "bf-list" }, ...SEND.map((q) => checkField(q, "enviado", answers)))),

      section("Perguntas", "Mais quatro perguntas", null,
        el("ol", { class: "bf-list" }, ...ASK.map((q, i) => textField(q, i + 12, answers)))),

      section("Combinados", "Para colocar no ar", "Marque de acordo em cada um. Se tiver dúvida, deixe em branco que a gente conversa.",
        el("ol", { class: "bf-list" }, ...AGREE.map((q) => checkField(q, "de acordo", answers)))),

      el("details", { class: "bf-section bf-past" },
        el("summary", {}, "Etapa 1 · suas respostas (dá para editar)"),
        el("ol", { class: "bf-list" }, ...STEP1.map((q, i) => textField(q, i + 1, answers))))));
  }

  init();
})();
