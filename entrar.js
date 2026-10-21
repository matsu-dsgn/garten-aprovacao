// Login único da equipe: depois de entrar, cada papel vai para o seu lugar.
(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  document.getElementById("brand").replaceChildren(el("img", { src: "assets/logo.svg", alt: "garten" }));
  document.getElementById("top-actions").append(GartenTheme.button());

  async function boot() {
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return GAuth.loginView(app, sb, boot);
    const role = await GAuth.role(sb);
    if (role === "admin") { location.replace("admin.html"); return; }
    if (role === "equipe") { location.replace("kanban.html"); return; }
    GAuth.noAccess(app, sb, user, boot);
  }
  boot();
})();
