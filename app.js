(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  const diagStateEl = document.getElementById("diagState");
  const btnPause = document.getElementById("btnPause");
  const btnReset = document.getElementById("btnReset");

  // =========================
  // Modèle (Seconde) : 1:1 strict
  // SA (acide salicylique) + MeOH (méthanol) -> MS (salicylate de méthyle) + H2O (eau)
  // - Pas de texte "réactif limitant" (consigne)
  // - Comptages visibles
  // - Mode prof masqué : choix du démarrage (1:1 / MeOH excès / SA excès)
  //
  // Option discrète via URL :
  //   ?start=meoh   ou  ?start=sa   ou  ?start=stoich
  // =========================

  const W = canvas.width;
  const H = canvas.height;

  // Lente par défaut (observation fine)
  const BASE = {
    dt: 1 / 60,
    speedMul: 1.0,
    reactionChance: 0.010,   // probabilité par collision "SA-MeOH" (faible = lent)
    kick: 0.35,              // impulsion lors de création produit
  };

  // Diagnostic (prof) = accélération + collisions efficaces bien plus vite
  const DIAG = {
    speedMul: 2.5,
    reactionChance: 0.16,
    kick: 0.85,
  };

  let diagnostic = false;
  let paused = false;

  // ---- Mode de démarrage (masqué)
  // "stoich" (1:1), "meoh" (MeOH excès), "sa" (SA excès)
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

  // Départ 1:1 strict par défaut
  const N0 = 14;
  const EXCESS = 8; // nombre en plus pour le réactif en excès (mode prof)

  // Couleurs (simples et constantes)
  const COLORS = {
    SA: "#f0d77a",   // acide salicylique (lourd)
    MeOH: "#7de3ff", // méthanol (petit, rapide)
    MS: "#ff9bd4",   // salicylate de méthyle (produit)
    H2O: "#b8ffb0",  // eau
    HUDbg: "rgba(0,0,0,0.35)",
  };

  // Particules
  const speciesProps = {
    SA:  { r: 15, m: 5.0, vmax: 0.55 },
    MeOH:{ r:  8, m: 1.0, vmax: 1.55 },
    MS:  { r: 16, m: 4.6, vmax: 0.75 },
    H2O: { r:  7, m: 0.8, vmax: 1.70 },
  };

  function rand(min, max) { return min + Math.random() * (max - min); }
  function vecLen(x, y) { return Math.hypot(x, y); }

  function randomVelocity(type) {
    const { vmax } = speciesProps[type];
    const a = rand(0, Math.PI * 2);
    const s = rand(0.35 * vmax, vmax);
    return { vx: Math.cos(a) * s, vy: Math.sin(a) * s };
  }

  function makeParticle(type, x, y, vx, vy) {
    const p = speciesProps[type];
    return { type, x, y, vx, vy, r: p.r, m: p.m };
  }

  // Placement sans gros chevauchement initial
  function spawnMany(type, n, region) {
    const out = [];
    let tries = 0;
    while (out.length < n && tries < 6000) {
      tries++;
      const x = rand(region.x0, region.x1);
      const y = rand(region.y0, region.y1);
      const { vx, vy } = randomVelocity(type);
      const candidate = makeParticle(type, x, y, vx, vy);

      let ok = true;
      for (const q of particles.concat(out)) {
        const d = vecLen(candidate.x - q.x, candidate.y - q.y);
        if (d < candidate.r + q.r + 2) { ok = false; break; }
      }
      if (ok) out.push(candidate);
    }
    return out;
  }

  let particles = [];

  function reset() {
    particles = [];

    // Zones : SA plutôt "bas/centre" (lourd), MeOH plus diffus (rapide)
    const saRegion = { x0: W*0.25, x1: W*0.75, y0: H*0.55, y1: H*0.85 };
    const meRegion = { x0: W*0.15, x1: W*0.85, y0: H*0.18, y1: H*0.70 };

    let nSA = N0;
    let nMe = N0;

    if (startMode === "meoh") nMe += EXCESS;
    if (startMode === "sa") nSA += EXCESS;

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

  // Rebonds sur parois
  function wallBounce(p) {
    if (p.x - p.r < 0) { p.x = p.r; p.vx *= -1; }
    if (p.x + p.r > W) { p.x = W - p.r; p.vx *= -1; }
    if (p.y - p.r < 0) { p.y = p.r; p.vy *= -1; }
    if (p.y + p.r > H) { p.y = H - p.r; p.vy *= -1; }
  }

  // Collision élastique simple (2D)
  function resolveCollision(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1e-9;
    const nx = dx / dist;
    const ny = dy / dist;

    // Correction de pénétration
    const overlap = (a.r + b.r) - dist;
    if (overlap > 0) {
      const totalM = a.m + b.m;
      a.x -= nx * overlap * (b.m / totalM);
      a.y -= ny * overlap * (b.m / totalM);
      b.x += nx * overlap * (a.m / totalM);
      b.y += ny * overlap * (a.m / totalM);
    }

    // Vitesse relative sur la normale
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

  // Réaction 1:1 strict sur collision SA + MeOH (probabiliste)
  function maybeReact(i, j) {
    const A = particles[i];
    const B = particles[j];
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

    const MS = makeParticle("MS", x - 10, y, v1.vx + kx, v1.vy + ky);
    const H2O = makeParticle("H2O", x + 10, y, v2.vx - kx, v2.vy - ky);

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

      p.vx += rand(-0.015, 0.015) * speedMul;
      p.vy += rand(-0.015, 0.015) * speedMul;

      const vmax = speciesProps[p.type].vmax * (diagnostic ? 1.25 : 1.0);
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
    const c = { SA: 0, MeOH: 0, MS: 0, H2O: 0 };
    for (const p of particles) c[p.type]++;
    return c;
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
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

    const x = 14, y = 14;
    const pad = 10;
    ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const w = 340;
    const h = pad * 2 + lines.length * 20 + 14;

    ctx.fillStyle = COLORS.HUDbg;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.90)";
    let yy = y + pad + 16;
    for (const s of lines) { ctx.fillText(s, x + pad, yy); yy += 20; }

    // Mentions prof uniquement en diagnostic (pas d'indice élève)
    if (diagnostic) {
      ctx.font = "13px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.globalAlpha = 0.85;
      const modeLabel = (startMode === "stoich") ? "1:1" : (startMode === "meoh" ? "MeOH excès" : "SA excès");
      ctx.fillText(`Diagnostic: ON • Départ: ${modeLabel}`, x + pad, y + h - 8);
      ctx.globalAlpha = 1;
    }
  }

  function drawParticle(p) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = COLORS[p.type];
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.stroke();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) drawParticle(p);
    drawHUD();
  }

  function loop() {
    if (!paused) step();
    draw();
    requestAnimationFrame(loop);
  }

  btnPause.addEventListener("click", togglePause);
  btnReset.addEventListener("click", reset);

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

  reset();
  diagStateEl.textContent = "OFF";
  loop();
})();