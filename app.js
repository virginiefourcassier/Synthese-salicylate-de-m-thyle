(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  const diagStateEl = document.getElementById("diagState");
  const btnPause = document.getElementById("btnPause");
  const btnReset = document.getElementById("btnReset");
  const btnLabels = document.getElementById("btnLabels");

  // =========================
  // Modèle (Seconde) : 1:1 strict
  // SA + MeOH -> MS + H2O (non affichée)
  // - Comptages visibles
  // - Mode prof masqué : démarrage 1:1 / MeOH excès / SA excès
  // - Représentation "modèle moléculaire compact" (boules + liaisons) par espèce
  // - Bouton réversible : afficher/masquer les symboles des atomes dans les molécules
  //
  // Option URL :
  //   ?start=stoich | ?start=meoh | ?start=sa
  // =========================

  const W = canvas.width;
  const H = canvas.height;

  // Lente par défaut
  const BASE = { dt: 1/60, speedMul: 1.0, reactionChance: 0.010, kick: 0.35 };
  // Diagnostic
  const DIAG = { speedMul: 2.5, reactionChance: 0.16, kick: 0.85 };

  let diagnostic = false;
  let paused = false;
  let showLabels = false;

  // ---- Mode de démarrage (masqué)
  let startMode = "stoich";
  function getStartModeFromURL() {
    try {
      const u = new URL(window.location.href);
      const v = (u.searchParams.get("start") || "").toLowerCase();
      if (v === "meoh") return "meoh";
      if (v === "sa") return "sa";
      if (v === "stoich") return "stoich";
    } catch (_) {}
    return null;
  }
  const urlMode = getStartModeFromURL();
  if (urlMode) startMode = urlMode;

  // Départ
  const N0 = 12;      // un peu moins pour garder lisibilité des modèles moléculaires
  const EXCESS = 7;   // en excès (mode prof)

  // Couleurs par atome (classiques "kits moléculaires")
  const ATOM_COLOR = {
    C: "#2b2b2b",   // noir
    H: "#f5f5f5",   // blanc
    O: "#e53935",   // rouge
  };

  // Légère bordure pour atomes clairs
  function atomStroke(symbol) {
    return (symbol === "H") ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.25)";
  }

  // "rayons" (dessin) des atomes
  const ATOM_R = { C: 7.5, H: 5.2, O: 7.8 };

  // Particules (collision disque) : rayon effectif
  // (le visuel est une molécule, mais la physique reste un disque pour simplicité/robustesse)
  const speciesPhysics = {
    SA:  { R: 18, m: 5.0, vmax: 0.55 },
    MeOH:{ R: 14, m: 1.0, vmax: 1.55 },
    MS:  { R: 19, m: 4.6, vmax: 0.75 },
    H2O: { R: 12, m: 0.8, vmax: 1.70 },
  };

  // --- Modèles moléculaires compacts (simplifiés mais reconnaissables)
  // Chaque modèle: atoms: [{sym, x, y}], bonds: [[i,j]]
  // Coordonnées relatives (en "unités"), ensuite mises à l'échelle.
  // NB: On simplifie fortement SA et MS (anneau aromatique + groupements O).
  const MODELS = {
    // Méthanol CH3OH: C central, O, 4 H approximés (3 autour C + 1 sur O)
    MeOH: {
      scale: 1.0,
      atoms: [
        { sym:"C", x: 0.0,  y: 0.0 },   // 0
        { sym:"O", x: 16.0, y: 0.0 },   // 1
        { sym:"H", x:-10.0, y:-10.0 },  // 2
        { sym:"H", x:-12.0, y:  8.0 },  // 3
        { sym:"H", x: -2.0, y: 14.0 },  // 4
        { sym:"H", x: 28.0, y: -8.0 },  // 5 (sur O)
      ],
      bonds: [
        [0,1],[0,2],[0,3],[0,4],[1,5]
      ],
    },

    // Eau H2O: O central + 2 H en V
    H2O: {
      scale: 1.0,
      atoms: [
        { sym:"O", x: 0.0, y: 0.0 },    // 0
        { sym:"H", x:-12.0, y: 9.0 },   // 1
        { sym:"H", x: 12.0, y: 9.0 },   // 2
      ],
      bonds: [[0,1],[0,2]],
    },

    // Acide salicylique (simplifié): anneau (6 C) + CO2H (C + 2 O) + OH (O + H)
    SA: {
      scale: 0.92,
      atoms: (() => {
        const atoms = [];
        // anneau benzénique (6 C)
        const R = 16;
        for (let k=0;k<6;k++){
          const a = (Math.PI/3)*k - Math.PI/6;
          atoms.push({ sym:"C", x: R*Math.cos(a), y: R*Math.sin(a) });
        }
        // groupement -CO2H attaché au C0 (approx)
        atoms.push({ sym:"C", x: atoms[0].x + 18, y: atoms[0].y - 2 });   // 6 carbonyle
        atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y - 10 });  // 7 O double
        atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y + 10 });  // 8 O alcool
        atoms.push({ sym:"H", x: atoms[8].x + 10, y: atoms[8].y + 6 });   // 9 H acide
        // groupement -OH attaché au C3 (ortho)
        atoms.push({ sym:"O", x: atoms[3].x - 16, y: atoms[3].y + 6 });   // 10 O
        atoms.push({ sym:"H", x: atoms[10].x - 10, y: atoms[10].y + 8 }); // 11 H
        return atoms;
      })(),
      bonds: (() => {
        const b = [];
        // anneau
        for (let k=0;k<6;k++) b.push([k,(k+1)%6]);
        // substituants
        b.push([0,6],[6,7],[6,8],[8,9],[3,10],[10,11]);
        return b;
      })(),
    },

    // Salicylate de méthyle (simplifié): SA où le -CO2H devient -CO2CH3
    MS: {
      scale: 0.92,
      atoms: (() => {
        const atoms = [];
        const R = 16;
        for (let k=0;k<6;k++){
          const a = (Math.PI/3)*k - Math.PI/6;
          atoms.push({ sym:"C", x: R*Math.cos(a), y: R*Math.sin(a) });
        }
        // carbonyle
        atoms.push({ sym:"C", x: atoms[0].x + 18, y: atoms[0].y - 2 });     // 6
        atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y - 10 });    // 7
        atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y + 10 });    // 8 (ester O)
        // groupe méthyle sur O (C + 3 H)
        atoms.push({ sym:"C", x: atoms[8].x + 16, y: atoms[8].y + 2 });     // 9
        atoms.push({ sym:"H", x: atoms[9].x + 10, y: atoms[9].y - 10 });    // 10
        atoms.push({ sym:"H", x: atoms[9].x + 12, y: atoms[9].y + 8 });     // 11
        atoms.push({ sym:"H", x: atoms[9].x - 2,  y: atoms[9].y + 14 });    // 12
        // groupe -OH ortho (conservé)
        atoms.push({ sym:"O", x: atoms[3].x - 16, y: atoms[3].y + 6 });     // 13
        atoms.push({ sym:"H", x: atoms[13].x - 10, y: atoms[13].y + 8 });   // 14
        return atoms;
      })(),
      bonds: (() => {
        const b = [];
        for (let k=0;k<6;k++) b.push([k,(k+1)%6]);
        b.push([0,6],[6,7],[6,8],[8,9],[9,10],[9,11],[9,12],[3,13],[13,14]);
        return b;
      })(),
    },
  };

  // HUD
  const HUD = { bg: "rgba(0,0,0,0.35)", fg: "rgba(255,255,255,0.90)" };

  function rand(min, max) { return min + Math.random() * (max - min); }
  function vecLen(x, y) { return Math.hypot(x, y); }

  function randomVelocity(type) {
    const vmax = speciesPhysics[type].vmax;
    const a = rand(0, Math.PI * 2);
    const s = rand(0.35 * vmax, vmax);
    return { vx: Math.cos(a) * s, vy: Math.sin(a) * s };
  }

  function makeParticle(type, x, y, vx, vy) {
    const p = speciesPhysics[type];
    return {
      type, x, y, vx, vy,
      r: p.R, m: p.m,
      ang: rand(0, Math.PI*2),   // orientation visuelle
      wang: rand(-0.02, 0.02),   // rotation lente
    };
  }

  let particles = [];

  function spawnMany(type, n, region) {
    const out = [];
    let tries = 0;
    while (out.length < n && tries < 8000) {
      tries++;
      const x = rand(region.x0, region.x1);
      const y = rand(region.y0, region.y1);
      const { vx, vy } = randomVelocity(type);
      const candidate = makeParticle(type, x, y, vx, vy);

      let ok = true;
      for (const q of particles.concat(out)) {
        const d = vecLen(candidate.x - q.x, candidate.y - q.y);
        if (d < candidate.r + q.r + 3) { ok = false; break; }
      }
      if (ok) out.push(candidate);
    }
    return out;
  }

  function reset() {
    particles = [];
    const saRegion = { x0: W*0.25, x1: W*0.75, y0: H*0.58, y1: H*0.88 };
    const meRegion = { x0: W*0.15, x1: W*0.85, y0: H*0.18, y1: H*0.72 };

    let nSA = N0, nMe = N0;
    if (startMode === "meoh") nMe += EXCESS;
    if (startMode === "sa")   nSA += EXCESS;

    particles.push(...spawnMany("SA", nSA, saRegion));
    particles.push(...spawnMany("MeOH", nMe, meRegion));

    paused = false;
    btnPause.textContent = "⏸ Pause";
  }

  function togglePause() {
    paused = !paused;
    btnPause.textContent = paused ? "▶ Reprendre" : "⏸ Pause";
  }

  function toggleDiagnostic() {
    diagnostic = !diagnostic;
    diagStateEl.textContent = diagnostic ? "ON" : "OFF";
  }

  function toggleLabels() {
    showLabels = !showLabels;
    btnLabels.textContent = showLabels ? "🔤 Masquer symboles" : "🔤 Afficher symboles";
  }

  function wallBounce(p) {
    if (p.x - p.r < 0) { p.x = p.r; p.vx *= -1; }
    if (p.x + p.r > W) { p.x = W - p.r; p.vx *= -1; }
    if (p.y - p.r < 0) { p.y = p.r; p.vy *= -1; }
    if (p.y + p.r > H) { p.y = H - p.r; p.vy *= -1; }
  }

  function resolveCollision(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1e-9;
    const nx = dx / dist;
    const ny = dy / dist;

    const overlap = (a.r + b.r) - dist;
    if (overlap > 0) {
      const totalM = a.m + b.m;
      a.x -= nx * overlap * (b.m / totalM);
      a.y -= ny * overlap * (b.m / totalM);
      b.x += nx * overlap * (a.m / totalM);
      b.y += ny * overlap * (a.m / totalM);
    }

    const rvx = b.vx - a.vx;
    const rvy = b.vy - a.vy;
    const relVel = rvx * nx + rvy * ny;
    if (relVel > 0) return;

    const e = 0.98;
    const j = -(1 + e) * relVel / (1 / a.m + 1 / b.m);

    a.vx -= (j / a.m) * nx;
    a.vy -= (j / a.m) * ny;
    b.vx += (j / b.m) * nx;
    b.vy += (j / b.m) * ny;
  }

  function currentParams() {
    if (!diagnostic) return BASE;
    return { dt: BASE.dt, speedMul: DIAG.speedMul, reactionChance: DIAG.reactionChance, kick: DIAG.kick };
  }

  function maybeReact(i, j) {
    const A = particles[i], B = particles[j];
    if (!A || !B) return false;

    const isPair =
      (A.type === "SA" && B.type === "MeOH") ||
      (A.type === "MeOH" && B.type === "SA");
    if (!isPair) return false;

    const { reactionChance, kick } = currentParams();
    if (Math.random() > reactionChance) return false;

    const x = (A.x + B.x) / 2;
    const y = (A.y + B.y) / 2;

    const ang = rand(0, Math.PI * 2);
    const kx = Math.cos(ang) * kick;
    const ky = Math.sin(ang) * kick;

    const v1 = randomVelocity("MS");
    const v2 = randomVelocity("H2O");

    const MS = makeParticle("MS", x - 12, y, v1.vx + kx, v1.vy + ky);
    const H2O = makeParticle("H2O", x + 12, y, v2.vx - kx, v2.vy - ky);

    const a = Math.max(i, j);
    const b = Math.min(i, j);
    particles.splice(a, 1);
    particles.splice(b, 1);

    particles.push(MS, H2O);
    return true;
  }

  function step() {
    const { dt, speedMul } = currentParams();

    for (const p of particles) {
      p.x += p.vx * 60 * dt * speedMul;
      p.y += p.vy * 60 * dt * speedMul;

      p.vx += rand(-0.014, 0.014) * speedMul;
      p.vy += rand(-0.014, 0.014) * speedMul;

      // rotation lente visuelle
      p.ang += p.wang * (diagnostic ? 1.8 : 1.0);

      const vmax = speciesPhysics[p.type].vmax * (diagnostic ? 1.25 : 1.0);
      const v = Math.hypot(p.vx, p.vy);
      if (v > vmax) { p.vx *= vmax / v; p.vy *= vmax / v; }

      wallBounce(p);
    }

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        if (dist < a.r + b.r) {
          const reacted = maybeReact(i, j);
          if (reacted) return;
          resolveCollision(a, b);
        }
      }
    }
  }

  function countTypes() {
    const c = { SA:0, MeOH:0, MS:0, H2O:0 };
    for (const p of particles) c[p.type]++;
    return c;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawHUD() {
    const c = countTypes();
    const lines = [
      `Acide salicylique : ${c.SA}`,
      `Méthanol : ${c.MeOH}`,
      `Salicylate de méthyle : ${c.MS}`,
      `Eau : ${c.H2O}`,
    ];

    const x = 14, y = 14, pad = 10;
    ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const w = 350;
    const h = pad*2 + lines.length*20 + 14;

    ctx.fillStyle = HUD.bg;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();

    ctx.fillStyle = HUD.fg;
    let yy = y + pad + 16;
    for (const s of lines) { ctx.fillText(s, x + pad, yy); yy += 20; }

    if (diagnostic) {
      ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.globalAlpha = 0.85;
      const modeLabel = (startMode === "stoich") ? "1:1" : (startMode === "meoh" ? "MeOH excès" : "SA excès");
      ctx.fillText(`Diagnostic: ON • Départ: ${modeLabel}`, x + pad, y + h - 8);
      ctx.globalAlpha = 1;
    }
  }

  function transformPoint(px, py, ang) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    return { x: px*ca - py*sa, y: px*sa + py*ca };
  }

  function drawMolecule(p) {
    const model = MODELS[p.type];
    if (!model) return;

    // échelle par espèce (pour compacité/lisibilité)
    let s = 1.0;
    if (p.type === "H2O") s = 0.95;
    if (p.type === "MeOH") s = 0.95;
    if (p.type === "SA") s = 0.90;
    if (p.type === "MS") s = 0.90;

    s *= model.scale || 1.0;

    // Liaisons (dessinées d'abord)
    ctx.lineCap = "round";
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = "rgba(220,220,220,0.75)";

    for (const [i,j] of model.bonds) {
      const ai = model.atoms[i];
      const aj = model.atoms[j];
      const pi = transformPoint(ai.x*s, ai.y*s, p.ang);
      const pj = transformPoint(aj.x*s, aj.y*s, p.ang);

      ctx.beginPath();
      ctx.moveTo(p.x + pi.x, p.y + pi.y);
      ctx.lineTo(p.x + pj.x, p.y + pj.y);
      ctx.stroke();
    }

    // Atomes
    for (const a of model.atoms) {
      const tp = transformPoint(a.x*s, a.y*s, p.ang);
      const x = p.x + tp.x;
      const y = p.y + tp.y;
      const sym = a.sym;

      const r = ATOM_R[sym] || 6.5;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI*2);
      ctx.fillStyle = ATOM_COLOR[sym] || "#cccccc";
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = atomStroke(sym);
      ctx.stroke();

      if (showLabels) {
        ctx.font = "bold 11.5px system-ui, -apple-system, Segoe UI, Roboto, Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        // couleur du texte : noir sur H, blanc ailleurs
        ctx.fillStyle = (sym === "H") ? "#111" : "#fff";
        ctx.fillText(sym, x, y + 0.2);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    // molécules
    for (const p of particles) drawMolecule(p);

    drawHUD();
  }

  function loop() {
    if (!paused) step();
    draw();
    requestAnimationFrame(loop);
  }

  // UI
  btnPause.addEventListener("click", togglePause);
  btnReset.addEventListener("click", reset);
  btnLabels.addEventListener("click", toggleLabels);

  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "p") togglePause();
    if (k === "r") reset();
    if (k === "d") toggleDiagnostic();

    // Mode prof masqué : change le démarrage puis reset
    if (k === "m") { startMode = "meoh"; reset(); }
    if (k === "s") { startMode = "sa"; reset(); }
    if (k === "n") { startMode = "stoich"; reset(); }
  });

  // Init
  reset();
  diagStateEl.textContent = "OFF";
  btnLabels.textContent = "🔤 Afficher symboles";
  loop();
})();