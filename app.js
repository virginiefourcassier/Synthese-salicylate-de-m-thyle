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
  const DIAG = { speedMul: 2.5, reactionChance: 0.16, kick: 0.85 };

  let diagnostic = false;
  let paused = false;
  let showLabels = false;

  // Température (facteur multiplicatif)
  let temperature = 1; // 1 à 5

  const ATOM_COLOR = { C:"#2b2b2b", H:"#f5f5f5", O:"#e53935" };
  const ATOM_R = { C:7.5, H:5.2, O:7.8 };

  function atomStroke(sym){ return (sym==="H") ? "rgba(0,0,0,0.40)" : "rgba(0,0,0,0.25)"; }

  const speciesPhysics = {
    SA:  { R: 18, m: 5.0, vmax: 0.55 },
    MeOH:{ R: 14, m: 1.0, vmax: 1.55 },
    MS:  { R: 19, m: 4.6, vmax: 0.75 },
    H2O: { R: 12, m: 0.8, vmax: 1.70 },
  };

  const MODELS = {
    MeOH:{scale:1,atoms:[{sym:"C",x:0,y:0},{sym:"O",x:16,y:0},{sym:"H",x:-10,y:-10},{sym:"H",x:-12,y:8},{sym:"H",x:-2,y:14},{sym:"H",x:28,y:-8}],bonds:[[0,1],[0,2],[0,3],[0,4],[1,5]]},
    H2O:{scale:1,atoms:[{sym:"O",x:0,y:0},{sym:"H",x:-12,y:9},{sym:"H",x:12,y:9}],bonds:[[0,1],[0,2]]},
    SA:{scale:.92,atoms:(()=>{const a=[],R=16;for(let k=0;k<6;k++){const t=Math.PI/3*k-Math.PI/6;a.push({sym:"C",x:R*Math.cos(t),y:R*Math.sin(t)})}
      a.push({sym:"C",x:a[0].x+18,y:a[0].y-2},{sym:"O",x:a[6].x+14,y:a[6].y-10},{sym:"O",x:a[6].x+14,y:a[6].y+10},{sym:"H",x:a[8].x+10,y:a[8].y+6},{sym:"O",x:a[3].x-16,y:a[3].y+6},{sym:"H",x:a[10].x-10,y:a[10].y+8});return a})(),
      bonds:(()=>{const b=[];for(let k=0;k<6;k++)b.push([k,(k+1)%6]);b.push([0,6],[6,7],[6,8],[8,9],[3,10],[10,11]);return b})()},
    MS:{scale:.92,atoms:(()=>{const a=[],R=16;for(let k=0;k<6;k++){const t=Math.PI/3*k-Math.PI/6;a.push({sym:"C",x:R*Math.cos(t),y:R*Math.sin(t)})}
      a.push({sym:"C",x:a[0].x+18,y:a[0].y-2},{sym:"O",x:a[6].x+14,y:a[6].y-10},{sym:"O",x:a[6].x+14,y:a[6].y+10},{sym:"C",x:a[8].x+16,y:a[8].y+2},
             {sym:"H",x:a[9].x+10,y:a[9].y-10},{sym:"H",x:a[9].x+12,y:a[9].y+8},{sym:"H",x:a[9].x-2,y:a[9].y+14},
             {sym:"O",x:a[3].x-16,y:a[3].y+6},{sym:"H",x:a[13].x-10,y:a[13].y+8});return a})(),
      bonds:(()=>{const b=[];for(let k=0;k<6;k++)b.push([k,(k+1)%6]);b.push([0,6],[6,7],[6,8],[8,9],[9,10],[9,11],[9,12],[3,13],[13,14]);return b})()}
  };

  let particles = [];

  function rand(min,max){return min+Math.random()*(max-min)}
  function vecLen(x,y){return Math.hypot(x,y)}

  function randomVelocity(type){
    const vmax = speciesPhysics[type].vmax * temperature;
    const a = rand(0,Math.PI*2);
    const s = rand(.35*vmax,vmax);
    return {vx:Math.cos(a)*s,vy:Math.sin(a)*s}
  }

  function makeParticle(type,x,y,vx,vy){
    const p = speciesPhysics[type];
    return {type,x,y,vx,vy,r:p.R,m:p.m,ang:rand(0,6.28),wang:rand(-.02,.02)}
  }

  function spawnMany(type,n,region){
    const out=[];
    let tries=0;
    while(out.length<n && tries<8000){
      tries++;
      const x=rand(region.x0,region.x1),y=rand(region.y0,region.y1);
      const {vx,vy}=randomVelocity(type);
      const c=makeParticle(type,x,y,vx,vy);
      let ok=true;
      for(const q of particles.concat(out)){
        if(vecLen(c.x-q.x,c.y-q.y)<c.r+q.r+3){ok=false;break}
      }
      if(ok) out.push(c)
    }
    return out
  }

  function reset(){
    particles=[];
    const nSA=parseInt(saRange.value),nMe=parseInt(meRange.value);
    const saR={x0:W*.25,x1:W*.75,y0:H*.6,y1:H*.88};
    const meR={x0:W*.15,x1:W*.85,y0:H*.18,y1:H*.72};
    particles.push(...spawnMany("SA",nSA,saR));
    particles.push(...spawnMany("MeOH",nMe,meR));
    paused=false;
    btnPause.textContent="⏸ Pause"
  }

  function currentParams(){
    if(!diagnostic) return BASE;
    return {dt:BASE.dt,speedMul:DIAG.speedMul,reactionChance:DIAG.reactionChance,kick:DIAG.kick}
  }

  function maybeReact(i,j){
    const A=particles[i],B=particles[j];
    if(!A||!B) return false;
    const pair=(A.type==="SA"&&B.type==="MeOH")||(A.type==="MeOH"&&B.type==="SA");
    if(!pair) return false;
    const {reactionChance,kick}=currentParams();
    if(Math.random()>reactionChance*temperature) return false;
    const x=(A.x+B.x)/2,y=(A.y+B.y)/2;
    const v1=randomVelocity("MS"),v2=randomVelocity("H2O");
    particles.splice(Math.max(i,j),1);
    particles.splice(Math.min(i,j),1);
    particles.push(makeParticle("MS",x-12,y,v1.vx+kick,v1.vy));
    particles.push(makeParticle("H2O",x+12,y,v2.vx-kick,v2.vy));
    return true
  }

  function wallBounce(p){
    if(p.x-p.r<0||p.x+p.r>W) p.vx*=-1;
    if(p.y-p.r<0||p.y+p.r>H) p.vy*=-1
  }

  function resolveCollision(a,b){
    const dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1e-9;
    if(d>=a.r+b.r) return;
    const nx=dx/d,ny=dy/d;
    const rv=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
    if(rv>0) return;
    const j=-(1+0.98)*rv/(1/a.m+1/b.m);
    a.vx-=j*nx/a.m; a.vy-=j*ny/a.m;
    b.vx+=j*nx/b.m; b.vy+=j*ny/b.m
  }

  function step(){
    const {dt,speedMul}=currentParams();
    for(const p of particles){
      p.x+=p.vx*60*dt*speedMul;
      p.y+=p.vy*60*dt*speedMul;
      p.vx+=rand(-.01,.01)*temperature;
      p.vy+=rand(-.01,.01)*temperature;
      p.ang+=p.wang;
      wallBounce(p)
    }
    for(let i=0;i<particles.length;i++){
      for(let j=i+1;j<particles.length;j++){
        const a=particles[i],b=particles[j];
        if(vecLen(a.x-b.x,a.y-b.y)<a.r+b.r){
          if(maybeReact(i,j)) return;
          resolveCollision(a,b)
        }
      }
    }
  }

  function drawMolecule(p){
    const m=MODELS[p.type]; if(!m) return;
    const s=m.scale;
    ctx.lineWidth=3.4; ctx.strokeStyle="rgba(40,40,40,.55)";
    for(const [i,j] of m.bonds){
      const A=m.atoms[i],B=m.atoms[j];
      const ax=p.x+(A.x*s*Math.cos(p.ang)-A.y*s*Math.sin(p.ang));
      const ay=p.y+(A.x*s*Math.sin(p.ang)+A.y*s*Math.cos(p.ang));
      const bx=p.x+(B.x*s*Math.cos(p.ang)-B.y*s*Math.sin(p.ang));
      const by=p.y+(B.x*s*Math.sin(p.ang)+B.y*s*Math.cos(p.ang));
      ctx.beginPath(); ctx.moveTo(ax,ay); ctx.lineTo(bx,by); ctx.stroke()
    }
    for(const A of m.atoms){
      const x=p.x+(A.x*s*Math.cos(p.ang)-A.y*s*Math.sin(p.ang));
      const y=p.y+(A.x*s*Math.sin(p.ang)+A.y*s*Math.cos(p.ang));
      ctx.beginPath(); ctx.arc(x,y,ATOM_R[A.sym],0,6.28);
      ctx.fillStyle=ATOM_COLOR[A.sym]; ctx.fill();
      ctx.strokeStyle=atomStroke(A.sym); ctx.stroke();
      if(showLabels){
        ctx.fillStyle=A.sym==="H"?"#111":"#fff";
        ctx.font="bold 11px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
        ctx.fillText(A.sym,x,y)
      }
    }
  }

  function draw(){
    ctx.clearRect(0,0,W,H);
    for(const p of particles) drawMolecule(p);
  }

  btnPause.onclick=()=>{paused=!paused;btnPause.textContent=paused?"▶ Reprendre":"⏸ Pause"};
  btnReset.onclick=reset;
  btnLabels.onclick=()=>{showLabels=!showLabels;btnLabels.textContent=showLabels?"🔤 Masquer symboles":"🔤 Afficher symboles"};

  function sync(){
    saVal.textContent=saRange.value;
    meVal.textContent=meRange.value;
    tVal.textContent=tRange.value;
    temperature=parseInt(tRange.value)
  }

  saRange.oninput=()=>{sync();reset()};
  meRange.oninput=()=>{sync();reset()};
  tRange.oninput=()=>{sync()};

  sync(); reset();
  (function loop(){ if(!paused) step(); draw(); requestAnimationFrame(loop) })();
})();