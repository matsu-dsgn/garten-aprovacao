// Página "perdido": 404 do site e destino de contas fora da equipe.
(() => {
  const CONTATO = ""; // link de WhatsApp ou site da Garten (vazio = botão escondido)
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  const page = document.getElementById("page");
  page.prepend(GartenIso.outline("login-mark a"), GartenIso.outline("login-mark b"));
  const cta = document.getElementById("cta");
  if (/^https:\/\//.test(CONTATO)) { cta.href = CONTATO; cta.hidden = false; }
})();
