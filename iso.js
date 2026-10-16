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

  // Um prédio por editoria. Cada função desenha no lote (x, y) com escala vertical k
  // e devolve [cx, cy, topo] para a planta brotar no ponto mais alto.
  const SHAPES = {
    torre(g, x, y, k) {
      const h = 3.6 * k;
      box(g, x + 0.5, y + 0.5, 0.8, 0.8, h);
      box(g, x + 0.38, y + 0.38, 1.04, 1.04, 0.22, h);
      return [x + 0.9, y + 0.9, h + 0.22];
    },
    degraus(g, x, y, k) {
      const s = 0.95 * k;
      box(g, x + 0.1, y + 0.1, 1.6, 1.6, s);
      box(g, x + 0.1, y + 0.1, 1.08, 1.6, s, s);
      box(g, x + 0.1, y + 0.1, 0.56, 1.6, s, 2 * s);
      return [x + 0.38, y + 0.9, 3 * s];
    },
    balanco(g, x, y, k) {
      const h = 2.3 * k;
      box(g, x + 0.15, y + 0.35, 0.85, 1.2, h);
      box(g, x + 0.15, y + 0.35, 1.75, 1.2, 0.5, h);
      return [x + 1.3, y + 0.95, h + 0.5];
    },
    pilotis(g, x, y, k) {
      const c = 0.85 * k, t = 0.14;
      for (const [dx, dy] of [[0.25, 0.25], [1.4, 0.25], [0.25, 1.4], [1.4, 1.4]]) box(g, x + dx, y + dy, t, t, c);
      box(g, x + 0.12, y + 0.12, 1.56, 1.56, 0.3, c);
      box(g, x + 0.45, y + 0.45, 0.9, 0.9, 1.1 * k, c + 0.3);
      return [x + 0.9, y + 0.9, c + 0.3 + 1.1 * k];
    },
    portal(g, x, y, k) {
      const h = 1.2 + 1.4 * k;
      box(g, x + 0.2, y + 0.5, 0.38, 0.8, h);
      box(g, x + 1.22, y + 0.5, 0.38, 0.8, h);
      box(g, x + 0.1, y + 0.42, 1.6, 0.96, 0.42, h);
      return [x + 0.9, y + 0.9, h + 0.42];
    },
    pavilhao(g, x, y, k) {
      const h = 0.45 + 0.6 * k;
      box(g, x + 0.15, y + 0.3, 1.5, 1.2, h);
      box(g, x - 0.05, y + 0.12, 1.9, 1.56, 0.14, h);
      return [x + 0.9, y + 0.9, h + 0.14];
    },
  };

  // Lotes numa grade 3x3; editorias ocupam o centro e a cruz, cantos viram lajes baixas
  const LOTS = [[0, 0], [2.2, 0], [4.4, 0], [0, 2.2], [2.2, 2.2], [4.4, 2.2], [0, 4.4], [2.2, 4.4], [4.4, 4.4]];
  const ORDER = [1, 3, 4, 5, 7, 0, 2, 6, 8];

  function build(items, counts) {
    const svg = node("svg", { class: "iso", viewBox: "-250 -150 500 400", role: "img", "aria-label": "Ilustração: um prédio por editoria do mês" });
    const n = Math.min(items.length, 9);
    const max = Math.max(1, ...counts);

    const B = 6.6, base = 0.35;
    node("polygon", { class: "base-side", points: pts([[-0.4, B, 0], [B, B, 0], [B, B, -base], [-0.4, B, -base]]) }, svg);
    node("polygon", { class: "base-side", points: pts([[B, -0.4, 0], [B, B, 0], [B, B, -base], [B, -0.4, -base]]) }, svg);
    node("polygon", { class: "base-top", points: pts([[-0.4, -0.4, 0], [B, -0.4, 0], [B, B, 0], [-0.4, B, 0]]) }, svg);
    for (const t of [2.0, 4.2]) {
      node("line", { class: "grid-line", x1: P(t, -0.4, 0)[0], y1: P(t, -0.4, 0)[1], x2: P(t, B, 0)[0], y2: P(t, B, 0)[1] }, svg);
      node("line", { class: "grid-line", x1: P(-0.4, t, 0)[0], y1: P(-0.4, t, 0)[1], x2: P(B, t, 0)[0], y2: P(B, t, 0)[1] }, svg);
    }

    const assign = new Array(9).fill(-1);
    for (let i = 0; i < n; i++) assign[ORDER[i]] = i;
    const groups = [];
    const drawOrder = LOTS.map((p, i) => i).sort((a, b) => (LOTS[a][0] + LOTS[a][1]) - (LOTS[b][0] + LOTS[b][1]));
    drawOrder.forEach((lot) => {
      const [x, y] = LOTS[lot];
      const idx = assign[lot];
      const g = node("g", { class: idx >= 0 ? "block" : "block filler" }, svg);
      if (idx < 0) { box(g, x + 0.2, y + 0.2, 1.4, 1.4, 0.22); return; }
      const k = 0.45 + 0.55 * (counts[idx] / max);   // altura acompanha o peso da editoria no mês
      const draw = SHAPES[items[idx].shape] || SHAPES.torre;
      const [cx, cy, top] = draw(g, x, y, k);
      sprout(g, cx, cy, top);
      if (!counts[idx]) g.classList.add("zero");
      g.dataset.idx = String(idx);
      groups[idx] = g;
    });
    return { svg, groups };
  }

  // Símbolo em outline, "estourado": traço fino que não escala com o tamanho
  const OUTLINE = "M472.6,112.8V31.8c0-14-11.3-25.3-25.3-25.3h-81c-6.7,0-13.1,2.6-17.9,7.4l-101.9,101.9c-4.8,4.8-7.4,11.1-7.4,17.9v27.2c0,7.6-9.2,11.4-14.6,6.1l-94.8-94.8c-4.8-4.8-11.1-7.4-17.9-7.4H31.1c-14,0-25.3,11.3-25.3,25.3v81c0,6.7,2.6,13.1,7.4,17.9l87,87,6.5,6.5c5.4,5.4,1.9,15.6-5.8,15.6H31.1c-14,0-25.3,11.3-25.3,25.3v81c0,6.7,2.6,13.1,7.4,17.9l101.9,101.9c4.8,4.8,11.1,7.4,17.9,7.4h81c14,0,25.3-11.3,25.3-25.3v-33.1h106.3c6.7,0,13.1-2.6,17.9-7.4l101.9-101.9c4.8-4.8,7.4-11.1,7.4-17.9v-81c0-14-11.3-25.3-25.3-25.3h-69.3c-7.6,0-12.4-9.8-7-15.1l94.2-94.2c4.8-4.8,7.4-11.1,7.4-17.9v.2ZM340.3,255.5l-93.7,93.7c-4.8,4.8-7.4,11.1-7.4,17.9v25.8c0,7.6-9.8,12.4-15.1,7l-79.3-79.3-7.1-7.1c-5.6-5.6-1.7-15.1,6.2-15.1h70.1c14,0,25.3-11.3,25.3-25.3v-12.3c0-11.5,9.3-20.8,20.8-20.8h73.8c8.2,0,12.3,9.9,6.4,15.6h0Z";
  function outline(cls) {
    const svg = node("svg", { class: "outline-mark " + cls, viewBox: "0 0 478.4 538", "aria-hidden": "true" });
    node("path", { d: OUTLINE }, svg);
    return svg;
  }

  return { build, outline };
})();
