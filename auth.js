// Login compartilhado (painel e Kanban): só Google.
// Quem entra só vê algo se o e-mail estiver na equipe (a regra fica no banco).
window.GAuth = (() => {
  const { el } = G;
  const field = (label, input) => el("label", { class: "f" }, label, input);
  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);

  function loginView(app, sb, onDone, error) {
    const out = msg(error || "", error ? "err" : "");
    const google = el("button", { class: "btn dark", type: "button" }, "Entrar com Google");
    google.addEventListener("click", async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href.split("#")[0] } });
      if (error) { out.className = "msg err"; out.textContent = error.message; }
    });
    app.replaceChildren(el("section", { class: "panel narrow" }, el("h2", {}, "Entrar"), google, out));
  }

  // Conta Google fora da equipe: fica presa aqui, sem botão de saída.
  // O bloqueio real é o banco (RLS); o clique direito travado é só charme.
  function noAccess(app) {
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    document.body.classList.add("locked");
    app.replaceChildren(el("section", { class: "panel narrow locked-box" },
      el("span", { class: "eyebrow" }, "Área restrita"),
      el("h2", {}, "Aqui não, parceiro."),
      el("p", {}, "Este espaço é só da equipe Garten. Se você caiu aqui por engano, pode fechar a aba.")));
  }

  async function role(sb) {
    const { data } = await sb.rpc("my_role");
    return data || null;
  }

  // Navegação do topo conforme o papel
  function nav(current, isAdmin) {
    const links = [["admin.html", "Painel"], ["kanban.html", "Kanban"]];
    if (!isAdmin) return null;
    return el("nav", { class: "topnav" }, links.map(([href, label]) =>
      el("a", { href, class: current === href ? "on" : "" }, label)));
  }

  return { loginView, noAccess, role, nav };
})();
