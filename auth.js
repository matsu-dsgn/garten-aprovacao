// Login compartilhado (painel e Kanban): Google ou e-mail e senha.
// Quem entra só vê algo se o e-mail estiver na equipe (a regra fica no banco).
window.GAuth = (() => {
  const { el } = G;
  const field = (label, input) => el("label", { class: "f" }, label, input);
  const msg = (text, kind = "") => el("p", { class: `msg ${kind}`, role: "status" }, text);

  function loginView(app, sb, onDone, error) {
    const email = el("input", { type: "email", autocomplete: "email", required: true });
    const pass = el("input", { type: "password", autocomplete: "current-password", minlength: "10", required: true });
    const out = msg(error || "", error ? "err" : "");
    const go = async (fn) => {
      out.className = "msg"; out.textContent = "…";
      const { error } = await fn({ email: email.value.trim().toLowerCase(), password: pass.value });
      if (error) { out.className = "msg err"; out.textContent = error.message; return; }
      onDone();
    };
    const google = el("button", { class: "btn dark", type: "button" }, "Entrar com Google");
    google.addEventListener("click", async () => {
      const { error } = await sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.href.split("#")[0] } });
      if (error) { out.className = "msg err"; out.textContent = error.message.includes("provider") ? "Login com Google ainda não está ativado no Supabase." : error.message; }
    });
    app.replaceChildren(el("section", { class: "panel narrow" },
      el("h2", {}, "Entrar"),
      google,
      el("details", {}, el("summary", {}, "Entrar com e-mail e senha"),
        el("div", { class: "stack" },
          field("E-mail", email), field("Senha (mín. 10 caracteres)", pass),
          el("div", { class: "row" },
            el("button", { class: "btn ghost", type: "button", onclick: () => go((c) => sb.auth.signInWithPassword(c)) }, "Entrar"),
            el("button", { class: "btn ghost", type: "button", onclick: () => go((c) => sb.auth.signUp(c)) }, "Criar acesso")))),
      out));
  }

  function noAccess(app, sb, user, onOut) {
    app.replaceChildren(el("section", { class: "panel narrow" },
      el("h2", {}, "Acesso não liberado"),
      el("p", {}, `O e-mail ${user.email || ""} ainda não está na equipe. Peça para o Rapha liberar.`),
      el("button", { class: "btn ghost", type: "button", onclick: async () => { await sb.auth.signOut(); onOut(); } }, "Sair")));
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
