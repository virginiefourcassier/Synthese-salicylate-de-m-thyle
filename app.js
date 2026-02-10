(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  const diagStateEl = document.getElementById("diagState");
  const btnPause = document.getElementById("btnPause");
  const btnReset = document.getElementById("btnReset");
  const btnLabels = document.getElementById("btnLabels");

  const saRange = document.getElementById("saRange");
  const meRange = document.getElementById("meRange");
  const saVal = document.getElementById("saVal");
  const meVal = document.getElementById("meVal");

  // =========================
  // Modèle (Seconde) : 1:1 strict
  // SA + MeOH -> MS + H2O (non affichée)
  // - Comptages visibles
  // - Curseurs: quantités initiales SA et MeOH
  // - Bouton réversible: symboles des atomes
  // - Raccourcis prof conservés (masqués)
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

  // Mode de démarrage via URL (optionnel, mais les curseurs restent prioritaires)
  // ?start=stoich | ?start=meoh | ?start=sa
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

  const EXCESS = 7; // excès (mode prof) si on utilise M/S

  // Couleurs par atome (kits moléculaires)
  const ATOM_COLOR = { C:"#2b2b2b", H:"#f5f5f5", O:"#e53935" };
  const ATOM_R = { C:7.5, H:5.2, O:7.8 };
  function atomStroke(sym){ return (sym==="H") ? "rgba(0,0,0,0.40)" : "rgba(0,0,0,0.25)"; }

  // Physique: collisions disque
  const speciesPhysics = {
    SA:  { R: 18, m: 5.0, vmax: 0.55 },
    MeOH:{ R: 14, m: 1.0, vmax: 1.55 },
    MS:  { R: 19, m: 4.6, vmax: 0.75 },
    H2O: { R: 12, m: 0.8, vmax: 1.70 },
  };

  // Modèles moléculaires compacts (simplifiés)
  const MODELS = {
    MeOH: {
      scale: 1.0,
      atoms: [
        { sym:"C", x: 0.0,  y: 0.0 },
        { sym:"O", x: 16.0, y: 0.0 },
        { sym:"H", x:-10.0, y:-10.0 },
        { sym:"H", x:-12.0, y:  8.0 },
        { sym:"H", x: -2.0, y: 14.0 },
        { sym:"H", x: 28.0, y: -8.0 },
      ],
      bonds: [[0,1],[0,2],[0,3],[0,4],[1,5]],
    },
    H2O: {
      scale: 1.0,
      atoms: [
        { sym:"O", x: 0.0, y: 0.0 },
        { sym:"H", x:-12.0, y: 9.0 },
        { sym:"H", x: 12.0, y: 9.0 },
      ],
      bonds: [[0,1],[0,2]],
    },
    SA: {
      scale: 0.92,
      atoms: (() => {
        const atoms = [];
        const R = 16;
        for (let k=0;k<6;k++){
          const a = (Math.PI/3)*k - Math.PI/6;
          atoms.push({ sym:"C", x: R*Math.cos(a), y: R*Math.sin(a) });
        }
        atoms.push({ sym:"C", x: atoms[0].x + 18, y: atoms[0].y - 2 });   // carbonyle
        atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y - 10 });
        atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y + 10 });
        atoms.push({ sym:"H", x: atoms[8].x + 10, y: atoms[8].y + 6 });   // H acide
        atoms.push({ sym:"O", x: atoms[3].x - 16, y: atoms[3].y + 6 });   // OH ortho
        atoms.push({ sym:"H", x: atoms[10].x - 10, y: atoms[10].y + 8 });
        return atoms;
      })(),
      bonds: (() => {
        const b = [];
        for (let k=0;k<6;k++) b.push([k,(k+1)%6]);
        b.push([0,6],[6,7],[6,8],[8,9],[3,10],[10,11]);
        return b;
      })(),
    },
    MS: {
      scale: 0.92,
      atoms: (() => {
        const atoms = [];
        const R = 16;
        for (let k=0;k<6;k++){
          const a = (Math.PI/3)*k - Math.PI/6;
          atoms.push({ sym:"C", x: R*Math.cos(a), y: R*Math.sin(a) });
        }
        atoms.push({ sym:"C", x: atoms[0].x + 18, y: atoms[0].y - 2 });     // carbonyle
        atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y - 10 });
        atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y + 10 });    // O ester
        atoms.push({ sym:"C", x: atoms[8].x + 16, y: atoms[8].y + 2 });     // CH3
        atoms.push({ sym:"H", x: atoms[9].x + 10, y: atoms[9].y - 10 });
        atoms.push({ sym:"H", x: atoms[9].x + 12, y: atoms[9].y + 8 });
        atoms.push({ sym:"H", x: atoms[9].x - 2,  y: atoms[9].y + 14 });
        atoms.push({ sym:"O", x: atoms[3].x - 16, y: atoms[3].y + 6 });     // OH ortho
        atoms.push({ sym:"H", x: atoms[13].x - 10, y: atoms[13].y + 8 });
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
  const HUD = { bg: "rgba(0,0,0,0.28)", fg: "rgba(0,0,0,0.88)" };

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
      ang: rand(0, Math.PI*2),
      wang: rand(-0.02, 0.02),
    };
  }

  let particles = [];

  function spawnMany(type, n, region) {
    const out = [];
    let tries = 0;
    while (out.length < n && tries < 9000) {
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

  function readInitialCounts() {
    let nSA = parseInt(saRange.value, 10);
    let nMe = parseInt(meRange.value, 10);

    // Si mode URL "stoich", on force l'égalité uniquement au chargement
    // (ensuite, les curseurs pilotent librement)
    if (startMode === "stoich") {
      const m = Math.min(nSA, nMe);
      nSA = m; nMe = m;
      saRange.value = String(m);
      meRange.value = String(m);
      saVal.textContent = String(m);
      meVal.textContent = String(m);
      startMode = "custom"; // une fois appliqué, on repasse en mode libre
    }

    return { nSA, nMe };
  }

  function reset() {
    particles = [];

    const saRegion = { x0: W*0.25, x1: W*0.75, y0: H*0.58, y1: H*0.88 };
    const meRegion = { x0: W*0.15, x1: W*0.85, y0: H*0.18, y1: H*0.72 };

    const { nSA, nMe } = readInitialCounts();

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

    // ✅ Correction troncature : on force l'alignement texte à gauche (il avait été modifié par les labels)
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";

    const x = 14, y = 14, pad = 12;
    ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    // largeur plus grande pour éviter toute coupe
    const w = 430;
    const h = pad*2 + lines.length*20 + 6;

    // fond semi-transparent clair
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();

    // légère bordure
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(0,0,0,0.10)";
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,0.86)";
    let yy = y + pad + 16;
    for (const s of lines) { ctx.fillText(s, x + pad, yy); yy += 20; }

    // mention prof uniquement en diagnostic (toujours masquée si diagnostic OFF)
    if (diagnostic) {
      ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.globalAlpha = 0.75;
      ctx.fillText("Diagnostic: ON", x + pad, y + h - 8);
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

    let s = 1.0;
    if (p.type === "H2O") s = 0.95;
    if (p.type === "MeOH") s = 0.95;
    if (p.type === "SA") s = 0.90;
    if (p.type === "MS") s = 0.90;
    s *= model.scale || 1.0;

    // liaisons
    ctx.lineCap = "round";
    ctx.lineWidth = 3.6;
    ctx.strokeStyle = "rgba(40,40,40,0.55)";

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

    // atomes
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
        ctx.fillStyle = (sym === "H") ? "#111" : "#fff";
        ctx.fillText(sym, x, y + 0.2);
      }
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) drawMolecule(p);
    drawHUD();
  }

  function loop() {
    if (!paused) step();
    draw();
    requestAnimationFrame(loop);
  }

  // UI events
  btnPause.addEventListener("click", togglePause);
  btnReset.addEventListener("click", reset);
  btnLabels.addEventListener("click", toggleLabels);

  function syncSliderLabels() {
    saVal.textContent = saRange.value;
    meVal.textContent = meRange.value;
  }

  saRange.addEventListener("input", () => { syncSliderLabels(); reset(); });
  meRange.addEventListener("input", () => { syncSliderLabels(); reset(); });

  // Raccourcis prof (masqués)
  window.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "p") togglePause();
    if (k === "r") reset();
    if (k === "d") toggleDiagnostic();

    // Mode prof masqué : force excès (sans affichage dédié)
    if (k === "m") { // MeOH en excès
      meRange.value = String(Math.min(30, parseInt(saRange.value,10) + EXCESS));
      syncSliderLabels(); reset();
    }
    if (k === "s") { // SA en excès
      saRange.value = String(Math.min(30, parseInt(meRange.value,10) + EXCESS));
      syncSliderLabels(); reset();
    }
    if (k === "n") { // retour 1:1 (min des deux)
      const m = Math.min(parseInt(saRange.value,10), parseInt(meRange.value,10));
      saRange.value = String(m);
      meRange.value = String(m);
      syncSliderLabels(); reset();
    }
  });

  // Init
  syncSliderLabels();
  reset();
  diagStateEl.textContent = "OFF";
  btnLabels.textContent = "🔤 Afficher symboles";
  loop();
})();