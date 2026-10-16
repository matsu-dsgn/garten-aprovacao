// Ilustração isométrica em traço (preto e branco + Green Yellow no ativo).
// Um prédio brutalista por editoria; a altura acompanha o peso da editoria no mês.
window.GartenIso = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const S = 34;
  const C = Math.cos(Math.PI / 6);
  const P = (x, y, z) => [(x - y) * C * S, (x + y) * 0.5 * S - z * S];
  const pts = (arr) => arr.map((p) => P(...p).map((n) => n.toFixed(1)).join(",")).join(" ");

  function node(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.append(n);
    return n;
  }
  const poly = (g, cls, arr) => node("polygon", { class: cls, points: pts(arr) }, g);
  const line = (g, cls, a, b) => { const [x1, y1] = P(...a), [x2, y2] = P(...b); return node("line", { class: cls, x1, y1, x2, y2 }, g); };

  // Caixa com faces: l = frente-esquerda (clara), r = frente-direita (escura), t = topo
  function box(g, x, y, w, d, h, z = 0, o = {}) {
    poly(g, "l", [[x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h]]);
    poly(g, "r", [[x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h]]);
    poly(g, o.topCls || "t", [[x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h]]);
    if (o.win) windows(g, x, y, w, d, h, z, o.win);
    if (o.bands) bands(g, x, y, w, d, h, z, o.bands);
  }

  // Grade de janelas nas duas faces visíveis
  let winCount = 0;
  function windows(g, x, y, w, d, h, z, { cols = 3, colsR = cols, rows, mx = 0.12, mz = 0.12, gap = 0.08 }) {
    rows = rows || Math.max(1, Math.round(h / 0.32));
    const face = (len, n, place) => {
      const cw = (len - 2 * mx - gap * (n - 1)) / n;
      const ch = (h - 2 * mz - gap * (rows - 1)) / rows;
      if (cw <= 0.03 || ch <= 0.03) return;
      for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) {
        const u = mx + c * (cw + gap), v = z + mz + r * (ch + gap);
        const p = place(u, v, cw, ch);
        p.style.animationDelay = `${((winCount++ * 137) % 1900) / 1000}s`;
      }
    };
    face(w, cols, (u, v, cw, ch) => poly(g, "win wl", [[x + u, y + d, v], [x + u + cw, y + d, v], [x + u + cw, y + d, v + ch], [x + u, y + d, v + ch]]));
    face(d, colsR, (u, v, cw, ch) => poly(g, "win wr", [[x + w, y + u, v], [x + w, y + u + cw, v], [x + w, y + u + cw, v + ch], [x + w, y + u, v + ch]]));
  }

  // Janelas recuadas: vão escuro + peitoril claro (profundidade)
  function coffers(g, x, y, w, d, h, z, { cols = 3, colsR = cols, rows, m = 0.1, gap = 0.07 }) {
    rows = rows || Math.max(1, Math.round(h / 0.3));
    const ch = (h - 2 * m - gap * (rows - 1)) / rows;
    const left = (u, v, cw) => {
      const a = poly(g, "win wl", [[x + u, y + d, v], [x + u + cw, y + d, v], [x + u + cw, y + d, v + ch], [x + u, y + d, v + ch]]);
      poly(g, "sill", [[x + u, y + d, v], [x + u + cw, y + d, v], [x + u + cw - cw * 0.18, y + d, v + ch * 0.22], [x + u + cw * 0.18, y + d, v + ch * 0.22]]);
      a.style.animationDelay = `${((winCount++ * 137) % 1900) / 1000}s`;
    };
    const right = (u, v, cw) => {
      const a = poly(g, "win wr", [[x + w, y + u, v], [x + w, y + u + cw, v], [x + w, y + u + cw, v + ch], [x + w, y + u, v + ch]]);
      poly(g, "sill r", [[x + w, y + u, v], [x + w, y + u + cw, v], [x + w, y + u + cw - cw * 0.18, v + ch * 0.22], [x + w, y + u + cw * 0.18, v + ch * 0.22]]);
      a.style.animationDelay = `${((winCount++ * 137) % 1900) / 1000}s`;
    };
    const run = (len, n, fn) => {
      const cw = (len - 2 * m - gap * (n - 1)) / n;
      if (cw <= 0.03 || ch <= 0.03) return;
      for (let r = 0; r < rows; r++) for (let c = 0; c < n; c++) fn(m + c * (cw + gap), z + m + r * (ch + gap), cw);
    };
    run(w, cols, left); run(d, colsR, right);
  }

  // Textura de fôrma de tábua nas faces
  function boards(g, x, y, w, d, h, z, step = 0.22) {
    for (let v = z + step; v < z + h - 0.02; v += step) {
      line(g, "board", [x, y + d, v], [x + w, y + d, v]);
      line(g, "board", [x + w, y, v], [x + w, y + d, v]);
    }
  }

  // Sombra projetada na face esquerda de um corpo, logo abaixo de um balanço
  function shade(g, x, y, w, d, ztop, depth = 0.35) {
    poly(g, "shade", [[x, y + d, ztop - depth], [x + w, y + d, ztop - depth * 0.6], [x + w, y + d, ztop], [x, y + d, ztop]]);
    poly(g, "shade", [[x + w, y, ztop - depth * 0.6], [x + w, y + d, ztop - depth * 0.6], [x + w, y + d, ztop], [x + w, y, ztop]]);
  }

  // Cilindro isométrico (tambor)
  function drum(g, cx, cy, r, h, z = 0, cls = "") {
    const rx = r * C * S * Math.SQRT2, ry = r * 0.5 * S * Math.SQRT2;
    const [bx, by] = P(cx, cy, z), [tx, ty] = P(cx, cy, z + h);
    node("path", { class: `drum-side ${cls}`, d: `M${tx - rx},${ty} L${bx - rx},${by} A${rx},${ry} 0 0 0 ${bx + rx},${by} L${tx + rx},${ty} Z` }, g);
    node("ellipse", { class: `drum-top ${cls}`, cx: tx, cy: ty, rx, ry }, g);
    return [rx, ry, tx, ty, bx, by];
  }

  // Faixas horizontais (janela em fita), típicas do brutalismo
  function bands(g, x, y, w, d, h, z, { n = 2, t = 0.14 }) {
    for (let i = 0; i < n; i++) {
      const v = z + (h / (n + 1)) * (i + 1) - t / 2;
      const s = poly(g, "win wl", [[x + 0.08, y + d, v], [x + w - 0.08, y + d, v], [x + w - 0.08, y + d, v + t], [x + 0.08, y + d, v + t]]);
      const r = poly(g, "win wr", [[x + w, y + 0.08, v], [x + w, y + d - 0.08, v], [x + w, y + d - 0.08, v + t], [x + w, y + 0.08, v + t]]);
      s.style.animationDelay = r.style.animationDelay = `${(i * 0.35).toFixed(2)}s`;
    }
  }

  function tree(g, x, y, z = 0, s = 1) {
    const [bx, by] = P(x, y, z);
    node("ellipse", { class: "shadow", cx: bx + 3 * s, cy: by + 1, rx: 8 * s, ry: 4 * s }, g);
    line(g, "trunk", [x, y, z], [x, y, z + 0.42 * s]);
    const [cx, cy] = P(x, y, z + 0.62 * s);
    node("circle", { class: "canopy", cx: cx - 3 * s, cy: cy + 2 * s, r: 7 * s }, g);
    node("circle", { class: "canopy", cx: cx + 3.5 * s, cy: cy + 1.5 * s, r: 6.5 * s }, g);
    node("circle", { class: "canopy", cx, cy: cy - 4 * s, r: 7.5 * s }, g);
  }

  function sprout(g, cx, cy, top) {
    const [sx, sy] = P(cx, cy, top);
    const s = node("g", { class: "sprout" }, g);
    node("path", { d: `M${sx},${sy} l0,-26 l-2,0 l0,26 z` }, s);
    node("path", { d: `M${sx - 1},${sy - 16} q-16,-4 -20,-18 q15,2 20,18 z` }, s);
    node("path", { d: `M${sx},${sy - 24} q14,-6 20,-22 q-16,3 -20,22 z` }, s);
  }

  // Pulso no chão do lote ativo
  function pulse(g, x, y) {
    const p = poly(g, "pulse", [[x - 0.05, y - 0.05, 0.02], [x + 1.85, y - 0.05, 0.02], [x + 1.85, y + 1.85, 0.02], [x - 0.05, y + 1.85, 0.02]]);
    const [cx, cy] = P(x + 0.9, y + 0.9, 0);
    p.style.transformOrigin = `${cx}px ${cy}px`;
  }

  // ---------- Os prédios ----------
  const SHAPES = {
    // Prazo certo: torre de blocos encaixados e deslocados
    torre(g, x, y, k) {
      const levels = 3 + Math.round(3 * k), mh = 0.52;
      box(g, x + 0.3, y + 0.3, 1.2, 1.2, 0.14);
      box(g, x + 0.65, y + 0.65, 0.5, 0.5, levels * mh, 0.14);
      boards(g, x + 0.65, y + 0.65, 0.5, 0.5, levels * mh, 0.14, 0.26);
      let top = 0.14;
      for (let i = 0; i < levels; i++) {
        const z = 0.14 + i * mh + 0.08;
        const a = i % 2 === 0;
        const bx = a ? x + 0.35 : x + 0.75, by = a ? y + 0.75 : y + 0.35;
        const bw = a ? 1.0 : 0.62, bd = a ? 0.62 : 1.0;
        box(g, bx, by, bw, bd, mh - 0.12, z);
        boards(g, bx, by, bw, bd, mh - 0.12, z, 0.13);
        if (i > 0) shade(g, bx, by, bw, bd, z, 0.12);
        top = z + mh - 0.12;
      }
      return [x + 0.9, y + 0.9, top];
    },
    // Imposto em mapa: pirâmide invertida com grelha profunda (Boston City Hall)
    degraus(g, x, y, k) {
      const h1 = 0.7 * k + 0.35, h2 = 0.45, h3 = 0.55 + 0.5 * k;
      box(g, x + 0.45, y + 0.45, 0.35, 0.9, h1);
      box(g, x + 1.0, y + 0.45, 0.35, 0.9, h1);
      poly(g, "door", [[x + 0.8, y + 1.35, 0], [x + 1.0, y + 1.35, 0], [x + 1.0, y + 1.35, h1 * 0.8], [x + 0.8, y + 1.35, h1 * 0.8]]);
      box(g, x + 0.3, y + 0.3, 1.2, 1.2, h2, h1, { });
      coffers(g, x + 0.3, y + 0.3, 1.2, 1.2, h2, h1, { cols: 4, rows: 1 });
      shade(g, x + 0.45, y + 0.45, 0.9, 0.9, h1, 0.2);
      box(g, x + 0.08, y + 0.08, 1.64, 1.64, h3, h1 + h2);
      coffers(g, x + 0.08, y + 0.08, 1.64, 1.64, h3, h1 + h2, { cols: 6, rows: Math.max(2, Math.round(h3 / 0.26)), gap: 0.05, m: 0.07 });
      shade(g, x + 0.3, y + 0.3, 1.2, 1.2, h1 + h2, 0.18);
      box(g, x + 0.04, y + 0.04, 1.72, 1.72, 0.12, h1 + h2 + h3);
      return [x + 0.9, y + 0.9, h1 + h2 + h3 + 0.12];
    },
    // Próximo passo: torre com cabeça em balanço e janelas em fita
    balanco(g, x, y, k) {
      const h = 1.6 + 1.6 * k, head = 0.95;
      box(g, x + 0.05, y + 0.9, 1.2, 0.8, 0.7, 0, { bands: { n: 2, t: 0.1 } });
      box(g, x + 0.2, y + 0.3, 0.75, 0.9, h - head, 0);
      coffers(g, x + 0.2, y + 0.3, 0.75, 0.9, h - head, 0, { cols: 2, colsR: 3 });
      boards(g, x + 0.2, y + 0.3, 0.75, 0.9, h - head, 0, 0.3);
      box(g, x + 0.1, y + 0.2, 1.75, 1.15, head, h - head, { bands: { n: 3, t: 0.12 } });
      boards(g, x + 0.1, y + 0.2, 1.75, 1.15, head, h - head, 0.08);
      shade(g, x + 0.2, y + 0.3, 0.75, 0.9, h - head, 0.4);
      return [x + 1.2, y + 0.8, h];
    },
    // Do zero ao CNPJ: duas torres sobre pilotis ligadas por pontes (Casa dos Sovietes)
    pilotis(g, x, y, k) {
      const c = 0.55, h = 1.3 + 1.5 * k;
      poly(g, "pave", [[x + 0.05, y + 0.05, 0.01], [x + 1.75, y + 0.05, 0.01], [x + 1.75, y + 1.5, 0.01], [x + 0.05, y + 1.5, 0.01]]);
      for (const [dx, dy] of [[0.15, 0.6], [0.55, 0.6], [0.15, 1.2], [0.55, 1.2], [1.1, 0.15], [1.5, 0.15], [1.1, 0.55], [1.5, 0.55]]) box(g, x + dx, y + dy, 0.1, 0.1, c);
      box(g, x + 1.05, y + 0.1, 0.65, 0.65, h, c);
      coffers(g, x + 1.05, y + 0.1, 0.65, 0.65, h, c, { cols: 3 });
      box(g, x + 0.72, y + 0.6, 0.35, 0.3, 0.22, c + h * 0.45);
      box(g, x + 0.72, y + 0.6, 0.35, 0.3, 0.22, c + h * 0.8);
      box(g, x + 0.1, y + 0.55, 0.65, 0.85, h * 0.92, c);
      coffers(g, x + 0.1, y + 0.55, 0.65, 0.85, h * 0.92, c, { cols: 3, colsR: 4 });
      return [x + 0.42, y + 0.97, c + h * 0.92];
    },
    // Com o Gabriel: tambor baixo com duas lâminas verticais
    pavilhao(g, x, y, k) {
      const dh = 0.45, bh = 1.0 + 1.4 * k;
      drum(g, x + 0.95, y + 0.95, 0.78, dh);
      drum(g, x + 0.95, y + 0.95, 0.62, 0.1, dh, "ring");
      box(g, x + 0.55, y + 0.35, 0.16, 0.85, bh);
      boards(g, x + 0.55, y + 0.35, 0.16, 0.85, bh, 0, 0.2);
      box(g, x + 1.1, y + 0.75, 0.75, 0.16, bh * 0.82);
      poly(g, "win wl", [[x + 1.42, y + 0.91, 0.25], [x + 1.52, y + 0.91, 0.25], [x + 1.52, y + 0.91, bh * 0.75], [x + 1.42, y + 0.91, bh * 0.75]]);
      line(g, "detail", [x + 1.47, y + 0.91, bh * 0.4], [x + 1.47, y + 0.91, bh * 0.55]);
      tree(g, x + 0.15, y + 1.7, 0, 0.6);
      return [x + 0.63, y + 0.77, bh];
    },
    // 13º e fim de ano: monumento de lâminas abertas
    portal(g, x, y, k) {
      const cx = x + 0.9, cy = y + 0.9, h = 1.6 + 1.4 * k;
      box(g, x + 0.3, y + 0.3, 1.2, 1.2, 0.18);
      const blade = (ang, reach, tip, side) => {
        const dx = Math.cos(ang), dy = Math.sin(ang);
        const b1 = [cx - dy * 0.08, cy + dx * 0.08, 0.18], b2 = [cx + dy * 0.08, cy - dx * 0.08, 0.18];
        const t = [cx + dx * reach, cy + dy * reach, tip];
        const m = [cx + dx * reach * 0.35, cy + dy * reach * 0.35, tip * 0.55];
        poly(g, side ? "l" : "r", [b1, m, t]); poly(g, side ? "r" : "l", [b2, m, t]);
      };
      [[-2.4, 0.55, h * 0.75, 1], [-0.8, 0.55, h * 0.75, 0], [0.8, 0.85, h * 0.6, 1], [2.4, 0.85, h * 0.6, 0], [-1.6, 0.25, h, 0], [1.6, 0.3, h * 0.95, 1], [0, 0.95, h * 0.5, 0], [3.14, 0.95, h * 0.5, 1]]
        .sort((a, b) => Math.sin(a[0]) + Math.cos(a[0]) - (Math.sin(b[0]) + Math.cos(b[0])))
        .forEach(([a, r, t, s]) => blade(a, r, t, s));
      return [cx, cy, h * 0.6];
    },
  };

  // Lote vazio vira praça
  function plaza(g, x, y, seed) {
    poly(g, "pave", [[x + 0.15, y + 0.15, 0.01], [x + 1.65, y + 0.15, 0.01], [x + 1.65, y + 1.65, 0.01], [x + 0.15, y + 1.65, 0.01]]);
    if (seed % 2) {
      for (const [dx, dy] of [[0.45, 0.45], [1.35, 0.45], [0.45, 1.35], [1.35, 1.35]]) tree(g, x + dx, y + dy, 0, 0.7);
    } else {
      box(g, x + 0.55, y + 0.55, 0.7, 0.7, 0.25);
      tree(g, x + 0.35, y + 1.4, 0, 0.7); tree(g, x + 1.45, y + 0.35, 0, 0.7);
    }
  }

  const LOTS = [[0, 0], [2.2, 0], [4.4, 0], [0, 2.2], [2.2, 2.2], [4.4, 2.2], [0, 4.4], [2.2, 4.4], [4.4, 4.4]];

  function build(items, counts) {
    winCount = 0;
    const svg = node("svg", { class: "iso", viewBox: "-250 -135 500 385", role: "img", "aria-label": "Ilustração: um prédio por editoria do mês" });
    const n = Math.min(items.length, 9);
    const max = Math.max(1, ...counts);

    // Terreno com ruas
    const B = 6.6, base = 0.35;
    poly(svg, "base-side", [[-0.4, B, 0], [B, B, 0], [B, B, -base], [-0.4, B, -base]]);
    poly(svg, "base-side r", [[B, -0.4, 0], [B, B, 0], [B, B, -base], [B, -0.4, -base]]);
    poly(svg, "base-top", [[-0.4, -0.4, 0], [B, -0.4, 0], [B, B, 0], [-0.4, B, 0]]);
    for (const t of [1.82, 4.02]) {
      poly(svg, "road", [[t, -0.4, 0], [t + 0.36, -0.4, 0], [t + 0.36, B, 0], [t, B, 0]]);
      poly(svg, "road", [[-0.4, t, 0], [B, t, 0], [B, t + 0.36, 0], [-0.4, t + 0.36, 0]]);
      line(svg, "lane", [t + 0.18, -0.4, 0], [t + 0.18, B, 0]);
      line(svg, "lane", [-0.4, t + 0.18, 0], [B, t + 0.18, 0]);
    }

    // Mais altos ao fundo, mais baixos na frente: nada fica escondido
    const RANK = { torre: 0, balanco: 1, pilotis: 2, portal: 3, degraus: 4, pavilhao: 5 };
    const LOT_ORDER = [0, 1, 3, 2, 6, 4, 5, 7, 8];
    const byHeight = items.slice(0, n).map((it, i) => i).sort((a, b) => (RANK[items[a].shape] ?? 9) - (RANK[items[b].shape] ?? 9));
    const assign = new Array(9).fill(-1);
    byHeight.forEach((idx, pos) => { assign[LOT_ORDER[pos]] = idx; });
    const groups = [];
    const drawOrder = LOTS.map((p, i) => i).sort((a, b) => (LOTS[a][0] + LOTS[a][1]) - (LOTS[b][0] + LOTS[b][1]));
    drawOrder.forEach((lot) => {
      const [x, y] = LOTS[lot];
      const idx = assign[lot];
      const g = node("g", { class: idx >= 0 ? "block" : "block filler" }, svg);
      if (idx < 0) { plaza(g, x, y, lot); return; }
      pulse(g, x, y);
      const k = 0.3 + 0.45 * (counts[idx] / max);
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
