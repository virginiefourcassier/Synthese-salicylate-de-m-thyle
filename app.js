(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  const diagStateEl = document.getElementById("diagState");
  const btnPause = document.getElementById("btnPause");
  const btnReset = document.getElementById("btnReset");
  const btnLabels = document.getElementById("btnLabels");

  const saRange = document.getElementById("saRange");
  const meRange = document.getElementById("meRange");
  const tRange  = document.getElementById("tRange");

  const saVal = document.getElementById("saVal");
  const meVal = document.getElementById("meVal");
  const tVal  = document.getElementById("tVal");

  const W = canvas.width;
  const H = canvas.height;

  const BASE = { dt: 1/60, speedMul: 1.0, reactionChance: 0.010, kick: 0.35 };
  const DIAG = { speedMul: 2.5, reactionChance: 0.16,  kick: 0.85 };

  let diagnostic = false;  // masqué
  let paused = false;
  let showLabels = false;

  // ✅ Température = multiplicateur DIRECT ×1 à ×5
  let temperature = 1;     // 1..5

  // --- Visuel ---
  const VIS_SCALE = 1.45;
  const ATOM_R = { C: 7.5*VIS_SCALE, H: 5.2*VIS_SCALE, O: 7.8*VIS_SCALE };
  const BOND_W = 3.6*VIS_SCALE;

  const ATOM_COLOR = { C:"#2b2b2b", H:"#f5f5f5", O:"#e53935" };
  function atomStroke(sym){ return (sym==="H") ? "rgba(0,0,0,0.40)" : "rgba(0,0,0,0.25)"; }

  // Physique: collision disque (rayons adaptés au visuel)
  const speciesPhysics = {
    SA:   { R: 18*VIS_SCALE, m: 5.0, vmax: 0.55 },
    MeOH: { R: 14*VIS_SCALE, m: 1.0, vmax: 1.55 },
    MS:   { R: 19*VIS_SCALE, m: 4.6, vmax: 0.75 },
    H2O:  { R: 12*VIS_SCALE, m: 0.8, vmax: 1.70 },
  };

  // --- Modèles (compacts) ---
  const MODELS = {
    MeOH: { scale: 1.0,
      atoms: [
        { sym:"C", x: 0.0,  y: 0.0 }, { sym:"O", x: 16.0, y: 0.0 },
        { sym:"H", x:-10.0, y:-10.0 },{ sym:"H", x:-12.0, y:  8.0 },
        { sym:"H", x: -2.0, y: 14.0 },{ sym:"H", x: 28.0, y: -8.0 },
      ],
      bonds: [[0,1],[0,2],[0,3],[0,4],[1,5]],
    },
    H2O: { scale: 1.0,
      atoms: [{ sym:"O", x:0, y:0 },{ sym:"H", x:-12, y:9 },{ sym:"H", x:12, y:9 }],
      bonds: [[0,1],[0,2]],
    },
    SA: (() => {
      const atoms = [];
      const R = 16;
      for (let k=0;k<6;k++){
        const a = (Math.PI/3)*k - Math.PI/6;
        atoms.push({ sym:"C", x: R*Math.cos(a), y: R*Math.sin(a) });
      }
      atoms.push({ sym:"C", x: atoms[0].x + 18, y: atoms[0].y - 2 });   // 6
      atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y - 10 });  // 7
      atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y + 10 });  // 8
      atoms.push({ sym:"H", x: atoms[8].x + 10, y: atoms[8].y + 6 });   // 9
      atoms.push({ sym:"O", x: atoms[3].x - 16, y: atoms[3].y + 6 });   // 10
      atoms.push({ sym:"H", x: atoms[10].x - 10, y: atoms[10].y + 8 }); // 11
      const bonds = [];
      for (let k=0;k<6;k++) bonds.push([k,(k+1)%6]);
      bonds.push([0,6],[6,7],[6,8],[8,9],[3,10],[10,11]);
      return { scale: 0.92, atoms, bonds };
    })(),
    MS: (() => {
      const atoms = [];
      const R = 16;
      for (let k=0;k<6;k++){
        const a = (Math.PI/3)*k - Math.PI/6;
        atoms.push({ sym:"C", x: R*Math.cos(a), y: R*Math.sin(a) });
      }
      atoms.push({ sym:"C", x: atoms[0].x + 18, y: atoms[0].y - 2 });     // 6
      atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y - 10 });    // 7
      atoms.push({ sym:"O", x: atoms[6].x + 14, y: atoms[6].y + 10 });    // 8
      atoms.push({ sym:"C", x: atoms[8].x + 16, y: atoms[8].y + 2 });     // 9
      atoms.push({ sym:"H", x: atoms[9].x + 10, y: atoms[9].y - 10 });    // 10
      atoms.push({ sym:"H", x: atoms[9].x + 12, y: atoms[9].y + 8 });     // 11
      atoms.push({ sym:"H", x: atoms[9].x - 2,  y: atoms[9].y + 14 });    // 12
      atoms.push({ sym:"O", x: atoms[3].x - 16, y: atoms[3].y + 6 });     // 13
      atoms.push({ sym:"H", x: atoms[13].x - 10, y: atoms[13].y + 8 });   // 14
      const bonds = [];
      for (let k=0;k<6;k++) bonds.push([k,(k+1)%6]);
      bonds.push([0,6],[6,7],[6,8],[8,9],[9,10],[9,11],[9,12],[3,13],[13,14]);
      return { scale: 0.92, atoms, bonds };
    })(),
  };

  // --- Utilitaires ---
  function rand(min, max){ return min + Math.random()*(max-min); }
  function dist(x,y){ return Math.hypot(x,y); }

  function currentParams(){
    if (!diagnostic) return BASE;
    return { dt: BASE.dt, speedMul: DIAG.speedMul, reactionChance: DIAG.reactionChance, kick: DIAG.kick };
  }

  // ✅ vitesses initiales ×temperature (jusqu'à ×5)
  function randomVelocity(type){
    const vmax = speciesPhysics[type].vmax * temperature;
    const a = rand(0, Math.PI*2);
    const s = rand(0.35*vmax, vmax);
    return { vx: Math.cos(a)*s, vy: Math.sin(a)*s };
  }

  function makeParticle(type, x, y, vx, vy){
    const p = speciesPhysics[type];
    return { type, x, y, vx, vy, r: p.R, m: p.m, ang: rand(0,Math.PI*2), wang: rand(-0.015,0.015) };
  }

  let particles = [];

  function spawnMany(type, n, region){
    const out = [];
    let tries = 0;
    while (out.length < n && tries < 14000){
      tries++;
      const x = rand(region.x0, region.x1);
      const y = rand(region.y0, region.y1);
      const {vx, vy} = randomVelocity(type);
      const c = makeParticle(type, x, y, vx, vy);
      let ok = true;
      for (const q of particles.concat(out)){
        if (dist(c.x-q.x, c.y-q.y) < c.r + q.r + 4) { ok = false; break; }
      }
      if (ok) out.push(c);
    }
    return out;
  }

  function syncUI(){
    saVal.textContent = saRange.value;
    meVal.textContent = meRange.value;
    tVal.textContent  = tRange.value;
    temperature = parseInt(tRange.value, 10);
  }

  function reset(){
    particles = [];
    const nSA = parseInt(saRange.value, 10);
    const nMe = parseInt(meRange.value, 10);

    const saRegion = { x0: W*0.25, x1: W*0.75, y0: H*0.60, y1: H*0.90 };
    const meRegion = { x0: W*0.15, x1: W*0.85, y0: H*0.18, y1: H*0.74 };

    particles.push(...spawnMany("SA", nSA, saRegion));
    particles.push(...spawnMany("MeOH", nMe, meRegion));

    paused = false;
    btnPause.textContent = "⏸ Pause";
  }

  function wallBounce(p){
    if (p.x - p.r < 0) { p.x = p.r; p.vx *= -1; }
    if (p.x + p.r > W) { p.x = W - p.r; p.vx *= -1; }
    if (p.y - p.r < 0) { p.y = p.r; p.vy *= -1; }
    if (p.y + p.r > H) { p.y = H - p.r; p.vy *= -1; }
  }

  function resolveCollision(a, b){
    const dx = b.x - a.x, dy = b.y - a.y;
    const d = Math.hypot(dx, dy) || 1e-9;
    if (d >= a.r + b.r) return;
    const nx = dx/d, ny = dy/d;

    const overlap = (a.r + b.r) - d;
    if (overlap > 0){
      const total = a.m + b.m;
      a.x -= nx * overlap * (b.m/total);
      a.y -= ny * overlap * (b.m/total);
      b.x += nx * overlap * (a.m/total);
      b.y += ny * overlap * (a.m/total);
    }

    const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    const rel = rvx*nx + rvy*ny;
    if (rel > 0) return;

    const e = 0.98;
    const j = -(1+e)*rel / (1/a.m + 1/b.m);
    a.vx -= (j/a.m)*nx; a.vy -= (j/a.m)*ny;
    b.vx += (j/b.m)*nx; b.vy += (j/b.m)*ny;
  }

  // ✅ réaction plus rapide : probabilité ×temperature (jusqu'à ×5)
  function maybeReact(i, j){
    const A = particles[i], B = particles[j];
    if (!A || !B) return false;
    const okPair = (A.type==="SA" && B.type==="MeOH") || (A.type==="MeOH" && B.type==="SA");
    if (!okPair) return false;

    const { reactionChance, kick } = currentParams();
    const chance = Math.min(0.95, reactionChance * temperature);
    if (Math.random() > chance) return false;

    const x = (A.x + B.x)/2, y = (A.y + B.y)/2;
    const v1 = randomVelocity("MS");
    const v2 = randomVelocity("H2O");

    const MS  = makeParticle("MS",  x-14, y, v1.vx + kick, v1.vy);
    const H2O = makeParticle("H2O", x+14, y, v2.vx - kick, v2.vy);

    const a = Math.max(i,j), b = Math.min(i,j);
    particles.splice(a,1);
    particles.splice(b,1);
    particles.push(MS, H2O);
    return true;
  }

  function step(){
    const { dt, speedMul } = currentParams();

    // ✅ déplacement ×temperature (jusqu'à ×5)
    const moveMul = temperature;

    // agitation (petit bruit) aussi ×temperature
    const jitter = 0.010 * temperature;

    for (const p of particles){
      p.x += p.vx * 60 * dt * speedMul * moveMul;
      p.y += p.vy * 60 * dt * speedMul * moveMul;

      p.vx += rand(-jitter, jitter);
      p.vy += rand(-jitter, jitter);

      p.ang += p.wang;

      // vmax ×temperature pour cohérence
      const vmax = speciesPhysics[p.type].vmax * temperature * (diagnostic ? 1.25 : 1.0);
      const v = Math.hypot(p.vx, p.vy);
      if (v > vmax){ p.vx *= vmax/v; p.vy *= vmax/v; }

      wallBounce(p);
    }

    for (let i=0;i<particles.length;i++){
      for (let j=i+1;j<particles.length;j++){
        const a = particles[i], b = particles[j];
        if (Math.hypot(b.x-a.x, b.y-a.y) < a.r + b.r){
          if (maybeReact(i,j)) return;
          resolveCollision(a,b);
        }
      }
    }
  }

  function transformPoint(px, py, ang){
    const ca = Math.cos(ang), sa = Math.sin(ang);
    return { x: px*ca - py*sa, y: px*sa + py*ca };
  }

  function drawMolecule(p){
    const model = MODELS[p.type];
    if (!model) return;
    const s = VIS_SCALE * (model.scale || 1.0);

    ctx.lineCap = "round";
    ctx.lineWidth = BOND_W;
    ctx.strokeStyle = "rgba(40,40,40,0.55)";
    for (const [i,j] of model.bonds){
      const ai = model.atoms[i], aj = model.atoms[j];
      const pi = transformPoint(ai.x*s, ai.y*s, p.ang);
      const pj = transformPoint(aj.x*s, aj.y*s, p.ang);
      ctx.beginPath();
      ctx.moveTo(p.x + pi.x, p.y + pi.y);
      ctx.lineTo(p.x + pj.x, p.y + pj.y);
      ctx.stroke();
    }

    for (const a of model.atoms){
      const tp = transformPoint(a.x*s, a.y*s, p.ang);
      const x = p.x + tp.x, y = p.y + tp.y;
      const sym = a.sym;
      const r = ATOM_R[sym] || (6*VIS_SCALE);

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI*2);
      ctx.fillStyle = ATOM_COLOR[sym] || "#ccc";
      ctx.fill();
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = atomStroke(sym);
      ctx.stroke();

      if (showLabels){
        ctx.font = `bold ${Math.max(11, 11*VIS_SCALE)}px system-ui`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = (sym==="H") ? "#111" : "#fff";
        ctx.fillText(sym, x, y);
      }
    }
  }

  function countTypes(){
    const c = { SA:0, MeOH:0, MS:0, H2O:0 };
    for (const p of particles) c[p.type]++;
    return c;
  }

  function roundRect(x,y,w,h,r){
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr,y);
    ctx.arcTo(x+w,y,x+w,y+h,rr);
    ctx.arcTo(x+w,y+h,x,y+h,rr);
    ctx.arcTo(x,y+h,x,y,rr);
    ctx.arcTo(x,y,x+w,y,rr);
    ctx.closePath();
  }

  function drawHUD(){
    const c = countTypes();
    const lines = [
      `Acide salicylique : ${c.SA}`,
      `Méthanol : ${c.MeOH}`,
      `Salicylate de méthyle : ${c.MS}`,
      `Eau : ${c.H2O}`,
    ];
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = "16px system-ui";

    const x=14, y=14, pad=12, w=430, h=pad*2 + lines.length*20 + 6;
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    roundRect(x,y,w,h,12); ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = "rgba(0,0,0,0.10)";
    ctx.stroke();

    ctx.fillStyle = "rgba(0,0,0,0.86)";
    let yy = y + pad + 16;
    for (const s of lines){ ctx.fillText(s, x+pad, yy); yy += 20; }
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    for (const p of particles) drawMolecule(p);
    drawHUD();
  }

  function loop(){
    if (!paused) step();
    draw();
    requestAnimationFrame(loop);
  }

  // UI
  btnPause.addEventListener("click", () => {
    paused = !paused;
    btnPause.textContent = paused ? "▶ Reprendre" : "⏸ Pause";
  });
  btnReset.addEventListener("click", reset);
  btnLabels.addEventListener("click", () => {
    showLabels = !showLabels;
    btnLabels.textContent = showLabels ? "🔤 Masquer symboles" : "🔤 Afficher symboles";
  });

  saRange.addEventListener("input", () => { syncUI(); reset(); });
  meRange.addEventListener("input", () => { syncUI(); reset(); });
  tRange.addEventListener("input",  () => { syncUI(); /* pas de reset */ });

  window.addEventListener("keydown", (e) => {
    if (e.key.toLowerCase() === "d") {
      diagnostic = !diagnostic;
      diagStateEl.textContent = diagnostic ? "ON" : "OFF";
    }
  });

  // init
  syncUI();
  reset();
  diagStateEl.textContent = "OFF";
  btnLabels.textContent = "🔤 Afficher symboles";
  loop();
})();