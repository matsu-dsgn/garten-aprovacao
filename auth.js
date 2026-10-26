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
    app.replaceChildren(el("section", { class: "panel narrow" }, el("h2", {}, "Entrar"), google, out,
      el("a", { class: "login-privacy", href: "privacidade.html" }, "Política de privacidade")));
  }

  // Conta Google fora da equipe: vai para a página "perdido" (a mesma do 404).
  // O bloqueio real é o banco (RLS); a página é só charme.
  function noAccess() { location.replace("404.html"); }

  async function role(sb) {
    const { data } = await sb.rpc("my_role");
    return data || null;
  }

  // Navegação do topo conforme o papel
  function nav(current, isAdmin) {
    const links = [["admin.html", "Painel", "painel"], ["kanban.html", "Kanban", "kanban"], ["radar.html", "Radar", "radar"], ["publicacoes.html", "Publicações", "publicacoes"], ["relatorio.html", "Relatório", "publicacoes"]];
    if (!isAdmin) return null;
    return el("nav", { class: "topnav" }, links.map(([href, label, ico]) => G.navLink(href, label, ico, current === href)));
  }

  // Botão "Sair" no topo, igual em todas as páginas da equipe
  function logout(sb) {
    if (document.querySelector(".logout")) return;
    document.getElementById("top-actions")?.append(el("button", { class: "theme-btn logout", type: "button",
      onclick: async () => { await sb.auth.signOut(); location.reload(); } }, "Sair"));
  }

  return { loginView, noAccess, role, nav, logout };
})();
