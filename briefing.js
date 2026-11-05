// Perguntas do painel de controle (link público + token, sem login).
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

  const QUESTIONS = [
    ["q1", "Vocês usam algum sistema contábil hoje (Domínio, Alterdata, Questor ou outro) para emitir guias e declarações? Ele exporta relatórios?"],
    ["q2", "Quantos clientes a Garten atende no total?"],
    ["q3", "Desses, quantos são MEI, quantos são Simples Nacional e quantos são Lucro Presumido ou outro regime?"],
    ["q4", "O faturamento de cada cliente é anotado todo mês na planilha? Em que dia do mês costuma ser atualizado?"],
    ["q5", "Para quantos clientes você emite nota fiscal no lugar deles? Tem um dia fixo por cliente?"],
    ["q6", "Que prazos você acompanha hoje (DAS, DASN-SIMEI, DCTFWeb, folha etc.)? Algum já foi perdido por falta de lembrete?"],
    ["q7", "Quem mais da equipe precisaria acessar o painel? Todos podem ver todos os clientes, ou o acesso precisa ser separado?"],
    ["q8", "Qual é a primeira coisa que você confere quando abre a planilha de manhã?"],
    ["q9", "Dos clientes PJ, quantos sócios também são atendidos por vocês como pessoa física (imposto de renda, carnê-leão etc.)?"],
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

  function field([key, label], i, answers) {
    const id = `ans-${key}`;
    const status = el("span", { class: "bf-status", role: "status", "aria-live": "polite" });
    const ta = el("textarea", { id, rows: 3, maxlength: MAX, placeholder: "Escreva aqui…" });
    ta.value = answers[key] || "";
    let timer = null, last = ta.value;

    const grow = () => { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
    const save = async () => {
      if (ta.value === last) return;
      const val = ta.value.slice(0, MAX);
      status.textContent = "Salvando…"; status.className = "bf-status";
      try { await rpc("briefing_save", { p_token: token, p_key: key, p_answer: val }); last = val; status.textContent = "Salvo"; status.className = "bf-status ok"; }
      catch { status.textContent = "Não salvou. Tente de novo."; status.className = "bf-status err"; }
    };
    ta.addEventListener("input", () => { grow(); clearTimeout(timer); timer = setTimeout(save, 900); });
    ta.addEventListener("blur", () => { clearTimeout(timer); save(); });
    requestAnimationFrame(grow);

    return el("li", { class: "bf-item" },
      el("label", { for: id }, el("span", { class: "bf-num" }, String(i + 1).padStart(2, "0")), el("span", {}, label)),
      ta, status);
  }

  async function init() {
    if (token.length !== 48) return gate("Link inválido", "Confira se você abriu o link completo que recebeu.");
    let data;
    try { data = await rpc("briefing_open", { p_token: token }); }
    catch (e) { return e.message === "invalid" ? gate("Link inválido", "Este link expirou ou foi trocado. Peça um novo ao Rapha.") : gate("Sem conexão", "Não foi possível carregar. Tente de novo em instantes."); }
    const answers = (data && data.answers) || {};
    app.replaceChildren(el("div", { class: "wrap bf" },
      el("header", { class: "bf-head" },
        el("p", { class: "bf-kicker" }, "Painel de controle"),
        el("h1", {}, "Antes de desenhar as telas, queremos entender como você trabalha hoje."),
        el("p", { class: "bf-lede" }, "Responda no seu tempo. Cada resposta salva sozinha, e você pode voltar pelo mesmo link para completar ou mudar."),
        el("p", { class: "bf-note" }, "Não coloque aqui CNPJ, faturamento ou outros dados dos seus clientes. Só precisamos saber como é o processo.")),
      el("ol", { class: "bf-list" }, ...QUESTIONS.map((q, i) => field(q, i, answers)))));
  }

  init();
})();
