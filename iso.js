// Ilustração isométrica: terreno com blocos brutalistas, um por pilar.
// Altura do bloco = quantidade de posts do pilar. O bloco ativo acende e brota.
window.GartenIso = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const S = 34;               // escala de 1 unidade
  const C = Math.cos(Math.PI / 6);
  const P = (x, y, z) => [(x - y) * C * S, (x + y) * 0.5 * S - z * S];
  const pts = (arr) => arr.map((p) => P(...p).map((n) => n.toFixed(1)).join(",")).join(" ");

  function node(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.append(n);
    return n;
  }

  function box(g, x, y, w, d, h, z = 0) {
    node("polygon", { class: "l", points: pts([[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]]) }, g);
    node("polygon", { class: "r", points: pts([[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]) }, g);
    node("polygon", { class: "t", points: pts([[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]) }, g);
  }

  function sprout(g, cx, cy, top) {
    const [sx, sy] = P(cx, cy, top);
    const s = node("g", { class: "sprout" }, g);
    node("path", { d: `M${sx},${sy} l0,-26 l-2,0 l0,26 z` }, s);
    node("path", { d: `M${sx - 1},${sy - 16} q-16,-4 -20,-18 q15,2 20,18 z` }, s);
    node("path", { d: `M${sx},${sy - 24} q14,-6 20,-22 q-16,3 -20,22 z` }, s);
  }

  // Layout fixo de lotes em uma grade 3x3 (unidades), do fundo para a frente
  const LOTS = [[0, 0], [2.2, 0], [4.4, 0], [0, 2.2], [2.2, 2.2], [4.4, 2.2], [0, 4.4], [2.2, 4.4], [4.4, 4.4]];
  const ORDER = [4, 1, 3, 5, 7, 0, 2, 6, 8]; // centro primeiro, depois em volta

  function build(pilares, counts) {
    const svg = node("svg", { class: "iso", viewBox: "-250 -235 500 445", role: "img", "aria-label": "Ilustração: um bloco por pilar do mês" });
    const n = Math.min(pilares.length, 9);
    const max = Math.max(1, ...counts);

    // Terreno
    const B = 6.6, base = 0.35;
    node("polygon", { class: "base-side", points: pts([[-0.4, B, 0], [B, B, 0], [B, B, -base], [-0.4, B, -base]]) }, svg);
    node("polygon", { class: "base-side", points: pts([[B, -0.4, 0], [B, B, 0], [B, B, -base], [B, -0.4, -base]]) }, svg);
    node("polygon", { class: "base-top", points: pts([[-0.4, -0.4, 0], [B, -0.4, 0], [B, B, 0], [-0.4, B, 0]]) }, svg);
    for (const t of [2.0, 4.2]) {
      node("line", { class: "grid-line", x1: P(t, -0.4, 0)[0], y1: P(t, -0.4, 0)[1], x2: P(t, B, 0)[0], y2: P(t, B, 0)[1] }, svg);
      node("line", { class: "grid-line", x1: P(-0.4, t, 0)[0], y1: P(-0.4, t, 0)[1], x2: P(B, t, 0)[0], y2: P(B, t, 0)[1] }, svg);
    }

    // Atribui lotes: pilares nos lotes de ORDER; o resto vira laje baixa decorativa
    const assign = new Array(9).fill(-1);
    for (let i = 0; i < n; i++) assign[ORDER[i]] = i;

    const groups = [];
    // desenha do fundo para a frente (x+y crescente) para a sobreposição correta
    const drawOrder = LOTS.map((p, i) => i).sort((a, b) => (LOTS[a][0] + LOTS[a][1]) - (LOTS[b][0] + LOTS[b][1]));
    drawOrder.forEach((lot) => {
      const [x, y] = LOTS[lot];
      const idx = assign[lot];
      const g = node("g", { class: idx >= 0 ? "block" : "block filler" }, svg);
      if (idx < 0) { box(g, x + 0.2, y + 0.2, 1.4, 1.4, 0.25); g.style.opacity = ".55"; return; }
      const h = 0.7 + (counts[idx] / max) * 2.6;
      // brutalismo: corpo + balanço superior deslocado
      box(g, x + 0.25, y + 0.25, 1.3, 1.3, h);
      box(g, x + 0.05, y + 0.45, 1.6, 0.9, 0.32, h);
      sprout(g, x + 0.85, y + 0.9, h + 0.32);
      g.dataset.idx = String(idx);
      groups[idx] = g;
    });
    return { svg, groups };
  }

  return { build };
})();
