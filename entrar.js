// Login único da equipe: depois de entrar, cada papel vai para o seu lugar.
(() => {
  const { el } = G;
  const cfg = window.GARTEN_CONFIG;
  const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.publishableKey);
  const app = document.getElementById("app");
  // Símbolo em outline estourado, como na capa do DS (composição A)
  const page = document.getElementById("page");
  page.prepend(GartenIso.outline("login-mark a"), GartenIso.outline("login-mark b"));
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
