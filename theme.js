// Aplica a escolha de tema antes de pintar a página (evita piscar).
// Sem escolha salva, a página segue o tema do sistema.
(() => {
  try {
    const t = localStorage.getItem("garten-theme");
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
  } catch { /* sem storage: segue o sistema */ }
})();

window.GartenTheme = {
  current() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  },
  toggle() {
    const next = this.current() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("garten-theme", next); } catch { /* ok */ }
    return next;
  },
  button() {
    const b = document.createElement("button");
    b.type = "button"; b.className = "theme-btn";
    const paint = () => {
      const dark = this.current() === "dark";
      b.textContent = dark ? "☀︎ Claro" : "☾ Escuro";
      b.setAttribute("aria-label", dark ? "Mudar para tema claro" : "Mudar para tema escuro");
    };
    b.addEventListener("click", () => { this.toggle(); paint(); });
    matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", paint);
    paint();
    return b;
  },
};
