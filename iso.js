// Ilustração isométrica: uma torre brutalista escultural, um andar por editoria.
// A altura de cada andar acompanha o peso da editoria no mês. Cores vêm do styles.css
// (mesmas classes .t/.l/.r/.wl/.wr e .on de antes). Loop: monta, gira andar a andar,
// explode e remonta.
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

  // Peças de cada andar: [x, y, largura, profundidade, início, fim] (início/fim em fração da altura do andar)
  const SETS = [
    [[-1.2, -0.47, 1, 0.87, 0, 1], [-0.27, 0.13, 0.73, 1.07, 0, 0.7], [0.4, -0.8, 0.8, 0.47, 0.3, 1], [-0.67, -1.13, 0.47, 0.67, 0.5, 1], [0.47, 0.33, 0.67, 0.47, 0, 0.45]],
    [[-0.33, -1.2, 0.67, 1, 0, 1], [-1.13, -0.2, 0.87, 0.6, 0.2, 1], [0.13, -0.07, 1.07, 0.53, 0, 0.75], [-0.2, 0.47, 0.47, 0.8, 0.3, 1]],
    [[-1.27, -0.67, 1, 0.93, 0, 1], [-0.07, 0.2, 1.2, 0.6, 0, 0.8], [0.33, -0.93, 0.47, 0.73, 0.4, 1], [-0.47, 0.33, 0.4, 0.87, 0.15, 0.85]],
    [[-0.6, -1.07, 1.33, 0.67, 0, 1], [-0.27, -0.2, 0.47, 1.27, 0.2, 1], [-1.13, 0.07, 0.67, 0.47, 0, 0.6]],
    [[-1, -0.4, 1.47, 0.73, 0, 1], [0.2, -0.93, 0.53, 0.6, 0.3, 1], [-0.13, 0.33, 0.4, 0.67, 0, 0.7]],
  ];
  const CORE = [-0.27, -0.27, 0.54, 0.54];
  const H = 5.2, MIN = 0.55, GAP = 0.1, T = 11;

  // Prisma girado em torno do núcleo; só as faces viradas para quem olha
  function solid(g, b, th, ox, oy, z0, z1, cls = "", win = false) {
    const cs = Math.cos(th), sn = Math.sin(th);
    const [x, y, w, d] = b;
    const c = [[x, y], [x + w, y], [x + w, y + d], [x, y + d]].map(([a, e]) => [a * cs - e * sn + ox, a * sn + e * cs + oy]);
    for (let k = 0; k < 4; k++) {
      const a = c[k], e = c[(k + 1) % 4];
      const dx = e[0] - a[0], dy = e[1] - a[1], nx = dy, ny = -dx;
      if (nx + ny <= 0.001) continue;
      const side = ny >= nx ? "l" : "r";
      poly(g, `${side} ${cls}`, [[...a, z0], [...e, z0], [...e, z1], [...a, z1]]);
      if (win && z1 - z0 > 0.4) {
        const m = (u, v) => [a[0] + dx * u, a[1] + dy * u, v];
        const za = z0 + (z1 - z0) * 0.4, zb = z0 + (z1 - z0) * 0.62;
        poly(g, `win w${side}`, [m(0.14, za), m(0.86, za), m(0.86, zb), m(0.14, zb)]);
      }
    }
    poly(g, `t ${cls}`, c.map((p) => [...p, z1]));
  }

  const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  // Estado de cada andar no tempo t do loop: rotação e explosão (0 = encaixado)
  function stateAt(t, i) {
    const base = (i % 2 ? 1 : -1) * Math.PI / 2;
    if (t < 1.8) { const k = ease(t / 1.8 - i * 0.06); return [base * (1 - k), 1 - k]; }
    if (t < 4) return [0, 0];
    if (t < 6.5) return [base * ease((t - 4 - i * 0.25) / 1.2), 0];
    if (t < 8) return [base, 0];
    if (t < 10) return [base, ease((t - 8 - i * 0.08) / 1.6)];
    return [base, 1];
  }

  let raf = null;
  function build(items, counts) {
    if (raf) cancelAnimationFrame(raf);
    const n = items.length;
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const svg = node("svg", { class: "iso iso-tower", viewBox: "-190 -340 380 410", role: "img", "aria-label": "Ilustração: uma torre com um andar por editoria do mês" });
    const ground = node("g", {}, svg);
    poly(ground, "base-side", [[-1.6, 1.6, 0], [1.6, 1.6, 0], [1.6, 1.6, -0.3], [-1.6, 1.6, -0.3]]);
    poly(ground, "base-side r", [[1.6, -1.6, 0], [1.6, 1.6, 0], [1.6, 1.6, -0.3], [1.6, -1.6, -0.3]]);
    poly(ground, "base-top", [[-1.6, -1.6, 0], [1.6, -1.6, 0], [1.6, 1.6, 0], [-1.6, 1.6, 0]]);
    const plinth = node("g", { class: "block plinth" }, svg);
    solid(plinth, [-0.8, -0.8, 1.6, 1.6], 0, 0, 0, 0, 0.2, "core");

    const heights = counts.map((c) => Math.max(MIN, (c / total) * H));
    const groups = items.map((it, i) => {
      const g = node("g", { class: "block floor" + (counts[i] ? "" : " zero") }, svg);
      g.dataset.idx = String(i);
      return g;
    });
    const cap = node("g", { class: "block plinth" }, svg);

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let last = "";
    function render(t) {
      const st = items.map((_, i) => stateAt(t, i));
      const sig = st.map(([a, e]) => a.toFixed(3) + "/" + e.toFixed(3)).join("|");
      if (sig === last) return; // parado: não redesenha e deixa as animações CSS rodarem
      last = sig;
      let z = 0.2;
      groups.forEach((g, i) => {
        g.replaceChildren();
        const [th, e] = st[i], h = heights[i];
        const ang = i * 1.9 + 0.6, ox = Math.cos(ang) * e * 1.1, oy = Math.sin(ang) * e * 1.1;
        const zz = z + e * 0.4 * (i + 1);
        const cs = Math.cos(th), sn = Math.sin(th);
        const list = SETS[i % SETS.length].map((b) => ({ b }));
        list.push({ b: [...CORE, 0, 1], core: true });
        list.map((it) => {
          const cx = it.b[0] + it.b[2] / 2, cy = it.b[1] + it.b[3] / 2;
          return { ...it, d: (cx * cs - cy * sn) + (cx * sn + cy * cs) + it.b[4] * 0.01 };
        }).sort((a, b) => a.d - b.d).forEach((it) => {
          if (it.core) solid(g, it.b, 0, 0, 0, z + e * 0.4 * i, zz + h, "core");
          else solid(g, it.b, th, ox, oy, zz + h * it.b[4], zz + h * it.b[5], "", true);
        });
        z += h + GAP;
      });
      cap.replaceChildren();
      solid(cap, CORE, 0, 0, 0, z, z + 0.35, "core");
    }

    if (reduce) render(3);
    else {
      const t0 = performance.now();
      const tick = (now) => {
        if (!svg.isConnected && now - t0 > 1000) { raf = null; return; }
        render(((now - t0) / 1000) % T);
        raf = requestAnimationFrame(tick);
      };
      render(0);
      raf = requestAnimationFrame(tick);
    }
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
