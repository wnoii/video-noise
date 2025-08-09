import React, { useEffect, useRef, useState } from "react";

export default function App(){
  const [inputUrl,setInputUrl]=useState("");
  const [status,setStatus]=useState("Upload an audio file or paste a direct audio URL");
  const [isPlaying,setIsPlaying]=useState(false);
  const [uiHidden,setUiHidden]=useState(false);
  const [theme,setTheme]=useState("space-galaxy");
  const [hasAudio,setHasAudio]=useState(false);

  // MonoWave controls
  const [smoothness,setSmoothness]=useState(0.25);
  const [waveHeight,setWaveHeight]=useState(1.2);
  const [waveLength,setWaveLength]=useState(1.0);
  const [lineThickness,setLineThickness]=useState(3);
  const [cleanMode,setCleanMode]=useState(true);
  const [glowIntensity,setGlowIntensity]=useState(0.8);

  const palettes=[
    {id:"classic",name:"Classic",low:"#66E3D5",high:"#FF7AC8"},
    {id:"mono",name:"Monochrome",low:"#FFFFFF",high:"#BFBFBF"},
    {id:"neon",name:"Neon Cyan/Magenta",low:"#7EF9FF",high:"#FF5ACD"},
    {id:"sunset",name:"Sunset",low:"#FFB86B",high:"#FFE8AA"},
    {id:"ice",name:"Ice Blue",low:"#A5C7FF",high:"#E0ECFF"},
  ];
  const [paletteId,setPaletteId]=useState("neon");
  const activePalette = palettes.find(p=>p.id===paletteId) || palettes[0];

  // Galaxy controls
  const [galaxySpeed,setGalaxySpeed]=useState(1.0);
  const [planetScale,setPlanetScale]=useState(1.0);
  const [galaxyRings,setGalaxyRings]=useState(5);
  const [planetsPer,setPlanetsPer]=useState(6);
  const [galaxyGlow,setGalaxyGlow]=useState(0.75);

  const audioRef=useRef(null);
  const canvasRef=useRef(null);
  const analyserRef=useRef(null);
  const audioCtxRef=useRef(null);
  const sourceRef=useRef(null);

  // dual-band nodes
  const lowFilterRef=useRef(null);
  const highFilterRef=useRef(null);
  const lowAnalyserRef=useRef(null);
  const highAnalyserRef=useRef(null);
  const lowTimeRef=useRef(null);
  const highTimeRef=useRef(null);

  const timeDataRef=useRef(null);
  const freqDataRef=useRef(null);
  const rafRef=useRef(null);
  const revealTimeoutRef=useRef(null);

  const THEMES=[
    {id:"space-galaxy",name:"Space Galaxy"},
    {id:"mono-wave",name:"Monochrome Waveform (Dual-Band)"},
    {id:"neon-particles",name:"Minimal Neon Particles"},
  ];

  const isYouTubeUrl=(url)=>/^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i.test(url);

  // audio graph
  const ensureCtx=()=>{
    if(!audioCtxRef.current) audioCtxRef.current=new (window.AudioContext||window.webkitAudioContext)();

    if(!analyserRef.current){
      analyserRef.current=audioCtxRef.current.createAnalyser();
      analyserRef.current.fftSize=2048;
      timeDataRef.current=new Uint8Array(analyserRef.current.fftSize);
      freqDataRef.current=new Uint8Array(analyserRef.current.frequencyBinCount);
    }
    if(!lowAnalyserRef.current){
      lowAnalyserRef.current=audioCtxRef.current.createAnalyser();
      lowAnalyserRef.current.fftSize=1024;
      lowTimeRef.current=new Uint8Array(lowAnalyserRef.current.fftSize);
    }
    if(!highAnalyserRef.current){
      highAnalyserRef.current=audioCtxRef.current.createAnalyser();
      highAnalyserRef.current.fftSize=1024;
      highTimeRef.current=new Uint8Array(highAnalyserRef.current.fftSize);
    }
    if(!lowFilterRef.current){
      const lf=audioCtxRef.current.createBiquadFilter();
      lf.type="lowpass"; lf.frequency.value=250; lf.Q.value=0.707;
      lowFilterRef.current=lf;
    }
    if(!highFilterRef.current){
      const hf=audioCtxRef.current.createBiquadFilter();
      hf.type="highpass"; hf.frequency.value=2000; hf.Q.value=0.707;
      highFilterRef.current=hf;
    }
  };

  const connectGraph=()=>{
    try{ sourceRef.current?.disconnect(); }catch{}
    try{ lowFilterRef.current?.disconnect(); highFilterRef.current?.disconnect(); }catch{}
    try{ lowAnalyserRef.current?.disconnect(); highAnalyserRef.current?.disconnect(); }catch{}
    try{ analyserRef.current?.disconnect(); }catch{}

    // Split and route
    const splitter = audioCtxRef.current.createChannelSplitter(2);
    sourceRef.current.connect(splitter);

    splitter.connect(lowFilterRef.current, 0);
    splitter.connect(lowFilterRef.current, 1);
    lowFilterRef.current.connect(lowAnalyserRef.current);

    splitter.connect(highFilterRef.current, 0);
    splitter.connect(highFilterRef.current, 1);
    highFilterRef.current.connect(highAnalyserRef.current);

    // full-band for energy + audio output
    sourceRef.current.connect(analyserRef.current);
    analyserRef.current.connect(audioCtxRef.current.destination);
  };

  // mouse reveal
  useEffect(()=>{
    if(!isPlaying){ setUiHidden(false); return; }
    const onMove=()=>{ setUiHidden(false); clearTimeout(revealTimeoutRef.current); revealTimeoutRef.current=setTimeout(()=>setUiHidden(true),1800); };
    window.addEventListener("mousemove",onMove);
    return ()=>{ window.removeEventListener("mousemove",onMove); clearTimeout(revealTimeoutRef.current); };
  },[isPlaying]);

  // canvas size + HiDPI
  const resizeCanvas=()=>{
    const c=canvasRef.current; if(!c) return;
    const dpr=window.devicePixelRatio||1;
    c.width=Math.floor(innerWidth*dpr);
    c.height=Math.floor(innerHeight*dpr);
    c.style.width=innerWidth+"px";
    c.style.height=innerHeight+"px";
    const ctx=c.getContext("2d");
    ctx.setTransform(dpr,0,0,dpr,0,0);
  };
  useEffect(()=>{ resizeCanvas(); addEventListener("resize",resizeCanvas); return ()=>removeEventListener("resize",resizeCanvas); },[]);

  // helpers
  const emaSmooth=(src,alpha)=>{
    const out=new Float32Array(src.length);
    let prev=src[0];
    for(let i=0;i<src.length;i++){ prev=alpha*src[i]+(1-alpha)*prev; out[i]=prev; }
    return out;
  };
  const cubicPath=(ctx,pts)=>{
    if(pts.length<2) return;
    ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]);
    for(let i=1;i<pts.length-1;i++){
      const [x0,y0]=pts[i-1]; const [x1,y1]=pts[i]; const [x2,y2]=pts[i+1];
      const nx=(x1+x2)/2, ny=(y1+y2)/2;
      ctx.quadraticCurveTo(x1,y1,nx,ny);
    }
    ctx.lineTo(pts[pts.length-1][0], pts[pts.length-1][1]);
  };

  // THEMES
  const renderSpaceGalaxy=(ctx,w,h,peak,t,bassGlow)=>{
    ctx.fillStyle="#05060a"; ctx.fillRect(0,0,w,h);
    const cx=w/2, cy=h/2;
    const coreR=Math.min(w,h)*(0.08+peak*0.04);
    let g=ctx.createRadialGradient(cx,cy,0,cx,cy,coreR*3);
    g.addColorStop(0,"rgba(255,235,190,0.9)");
    g.addColorStop(0.35,"rgba(255,160,120,0.35)");
    g.addColorStop(1,"rgba(0,0,0,0)");
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,cy,coreR*3,0,Math.PI*2); ctx.fill();

    ctx.strokeStyle="rgba(180,200,255,0.15)"; ctx.lineWidth=2;
    for(let arm=0; arm<3; arm++){
      ctx.beginPath();
      for(let a=0; a<Math.PI*2; a+=0.12){
        const r=coreR*0.6 + a*(Math.min(w,h)*0.06);
        const x=cx+Math.cos(a+arm*2.1)*r;
        const y=cy+Math.sin(a+arm*2.1)*r;
        if(a===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }

    const rings=Math.max(1,Math.min(12,Math.round(galaxyRings)));
    const perRing=Math.max(1,Math.min(16,Math.round(planetsPer)));
    for(let r=1;r<=rings;r++){
      const orbitR=coreR*1.5 + r*(Math.min(w,h)*0.09);
      ctx.strokeStyle="rgba(255,255,255,0.06)"; ctx.lineWidth=1;
      ctx.beginPath(); ctx.arc(cx,cy,orbitR,0,Math.PI*2); ctx.stroke();
      for(let i=0;i<perRing;i++){
        const speed=(0.1+r*0.03)*galaxySpeed;
        const ang=t*speed + (i/perRing)*Math.PI*2;
        const x=cx+Math.cos(ang)*orbitR;
        const y=cy+Math.sin(ang)*orbitR;
        const rad=Math.max(2,(4+r*1.2)*planetScale);

        ctx.save();
        ctx.shadowColor="rgba(150,180,255,0.9)";
        const minG=6, maxG=28;
        ctx.shadowBlur=minG+(maxG-minG)*bassGlow*galaxyGlow;
        let pg=ctx.createRadialGradient(x,y,0,x,y,rad*2.4);
        pg.addColorStop(0,`hsla(${220+r*12},100%,${55-r*6}%,0.9)`);
        pg.addColorStop(1,"rgba(0,0,0,0)");
        ctx.fillStyle=pg; ctx.beginPath(); ctx.arc(x,y,rad*2.4,0,Math.PI*2); ctx.fill();
        ctx.restore();

        ctx.fillStyle=`hsl(${220+r*12},70%,${55-r*6}%)`; ctx.beginPath(); ctx.arc(x,y,rad,0,Math.PI*2); ctx.fill();
      }
    }

    const stars=70+Math.floor(peak*120);
    ctx.fillStyle="rgba(255,255,255,0.8)";
    for(let i=0;i<stars;i++){ ctx.fillRect(Math.random()*w|0, Math.random()*h|0, 1, 1); }
  };

  const renderMonoWave=(ctx,w,h,bassGlow)=>{
    lowAnalyserRef.current.getByteTimeDomainData(lowTimeRef.current);
    highAnalyserRef.current.getByteTimeDomainData(highTimeRef.current);
    const lowN=lowTimeRef.current.length, highN=highTimeRef.current.length;
    const lowSrc=new Float32Array(lowN), highSrc=new Float32Array(highN);
    for(let i=0;i<lowN;i++) lowSrc[i]=(lowTimeRef.current[i]-128)/128;
    for(let i=0;i<highN;i++) highSrc[i]=(highTimeRef.current[i]-128)/128;

    const maxWin=256; const win=1+Math.round(smoothness*maxWin);
    const alpha=2/(win+1);
    const lowSm=cleanMode? emaSmooth(lowSrc,alpha):lowSrc;
    const highSm=cleanMode? emaSmooth(highSrc,alpha):highSrc;

    const stride=Math.max(1, Math.round(1/waveLength));
    const lowPts=[], highPts=[];
    for(let i=0;i<lowN;i+=stride){ const x=(i/(lowN-1))*w; const y=h/2 + lowSm[i]*(h/3)*waveHeight; lowPts.push([x,y]); }
    for(let i=0;i<highN;i+=stride){ const x=(i/(highN-1))*w; const y=h/2 + highSm[i]*(h/3)*Math.max(0.6,waveHeight*0.7); highPts.push([x,y]); }

    ctx.fillStyle="#000"; ctx.fillRect(0,0,w,h);
    const minGlow=4, maxGlow=20; const glow=minGlow+(maxGlow-minGlow)*bassGlow*glowIntensity;

    ctx.save();
    ctx.lineWidth=lineThickness; ctx.strokeStyle=activePalette.low;
    if(cleanMode){ ctx.shadowBlur=glow; ctx.shadowColor=activePalette.low; }
    if(cleanMode) { cubicPath(ctx,lowPts); } else { ctx.beginPath(); lowPts.forEach(([x,y],i)=> i?ctx.lineTo(x,y):ctx.moveTo(x,y)); }
    ctx.stroke(); ctx.restore();

    ctx.save();
    ctx.lineWidth=Math.max(1,lineThickness-1); ctx.strokeStyle=activePalette.high;
    if(cleanMode){ ctx.shadowBlur=glow*0.8; ctx.shadowColor=activePalette.high; }
    if(cleanMode) { cubicPath(ctx,highPts); } else { ctx.beginPath(); highPts.forEach(([x,y],i)=> i?ctx.lineTo(x,y):ctx.moveTo(x,y)); }
    ctx.stroke(); ctx.restore();
  };

  const renderNeonParticles=(ctx,w,h,peak,t)=>{
    ctx.fillStyle="#04060a"; ctx.fillRect(0,0,w,h);
    const count=160+Math.floor(peak*200);
    for(let i=0;i<count;i++){
      const x=(Math.sin((i*53.1)+t*0.8)*0.5+0.5)*w;
      const y=(Math.cos((i*71.7)+t*0.6)*0.5+0.5)*h;
      const r=1+(i%5)+peak*3;
      ctx.fillStyle=`hsla(${(i*7)%360},100%,65%,${0.2+(i%3)*0.05})`;
      ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    }
  };

  const renderFrame=()=>{
    if(!canvasRef.current || !analyserRef.current) return;
    const ctx=canvasRef.current.getContext("2d");
    const dpr=window.devicePixelRatio||1;
    const w=canvasRef.current.width/dpr, h=canvasRef.current.height/dpr;

    analyserRef.current.getByteTimeDomainData(timeDataRef.current);
    analyserRef.current.getByteFrequencyData(freqDataRef.current);

    let sum=0; for(let i=0;i<timeDataRef.current.length;i++){ const v=(timeDataRef.current[i]-128)/128; sum+=v*v; }
    const energy=Math.sqrt(sum/timeDataRef.current.length);
    const bassBins=Math.max(8, Math.floor(freqDataRef.current.length/8));
    let bsum=0; for(let i=0;i<bassBins;i++) bsum+=freqDataRef.current[i];
    const bassGlow=Math.min(1, Math.max(0, (bsum/bassBins)/255 ));

    const t=performance.now()/1000;
    switch(theme){
      case "space-galaxy": renderSpaceGalaxy(ctx,w,h,energy,t,bassGlow); break;
      case "mono-wave": renderMonoWave(ctx,w,h,bassGlow); break;
      case "neon-particles": renderNeonParticles(ctx,w,h,energy,t); break;
      default: renderSpaceGalaxy(ctx,w,h,energy,t,bassGlow);
    }
    rafRef.current=requestAnimationFrame(renderFrame);
  };

  useEffect(()=>{
    if(isPlaying && analyserRef.current){ cancelAnimationFrame(rafRef.current); rafRef.current=requestAnimationFrame(renderFrame); }
    else { cancelAnimationFrame(rafRef.current); }
  },[isPlaying, theme, smoothness, waveHeight, waveLength, lineThickness, paletteId, cleanMode, glowIntensity, galaxySpeed, planetScale, galaxyRings, planetsPer, galaxyGlow]);

  // controls
  const handlePlayPause=async()=>{
    if(!hasAudio){ setStatus("Load an audio file or direct URL first."); return; }
    try{ if(!audioCtxRef.current) ensureCtx(); if(audioCtxRef.current.state==="suspended") await audioCtxRef.current.resume(); }catch{}
    if(audioRef.current.paused){
      try{
        await audioRef.current.play();
        setIsPlaying(true); setUiHidden(true);
      } catch(e){
        // Fallback: try muted play then unmute shortly after (iOS/Safari policies)
        try{
          audioRef.current.muted=true;
          await audioRef.current.play();
          setIsPlaying(true); setUiHidden(true);
          setTimeout(()=>{ try{ audioRef.current.muted=false; }catch{} }, 200);
          setStatus("Playing (auto-unmuted)");
        }catch(_e){
          setStatus("Autoplay blocked. Click Play again.");
        }
      }
    } else {
      audioRef.current.pause(); setIsPlaying(false); setUiHidden(false);
    }
  };

  const handleFileDrop=(e)=>{ e.preventDefault(); const f=e.dataTransfer.files?.[0]; if(f) loadLocalFile(f); };
  const loadLocalFile=(file)=>{
    const url=URL.createObjectURL(file);
    attachAudio(url); setStatus(`Loaded: ${file.name}`); setHasAudio(true);
  };
  const attachAudio=(src)=>{
    ensureCtx();
    if(audioRef.current){
      try{ audioRef.current.pause(); }catch{}
      audioRef.current.preload="auto";
      audioRef.current.playsInline=true;
      audioRef.current.muted=false; // ensure not muted by default
      audioRef.current.crossOrigin="anonymous";
      audioRef.current.src=src;
      try{ audioRef.current.load(); }catch{}
      audioRef.current.oncanplay=()=> setStatus("Ready. Hit Play ▶");
      audioRef.current.oncanplaythrough=()=> setStatus("Ready. Hit Play ▶");
      audioRef.current.onended=()=>{ setIsPlaying(false); setUiHidden(false); };
      audioRef.current.onerror=()=>{
        const err=audioRef.current.error; const code=err?.code; const msg=err?`Error ${code}`:"Unknown audio error";
        setStatus(`Playback error. ${msg}`);
        // Fallback: if decode/src unsupported (3/4) and current src is proxy URL, retry by buffering to Blob
        try{
          const currentSrc = audioRef.current.currentSrc || audioRef.current.src || "";
          if((code===3 || code===4) && currentSrc && !currentSrc.startsWith('blob:') && /\/api\/youtube\?/.test(currentSrc)){
            setStatus('Decode failed. Buffering audio…');
            fetch(currentSrc).then(async(r)=>{
              if(!r.ok) throw new Error('http');
              const b=await r.blob();
              const url=URL.createObjectURL(b);
              attachAudio(url);
              setHasAudio(true);
              setStatus('Ready. Hit Play ▶');
            }).catch(()=>{ /* ignore */ });
          }
        }catch{}
      };
      if(!sourceRef.current){
        const node=audioCtxRef.current.createMediaElementSource(audioRef.current);
        sourceRef.current=node;
      }
      connectGraph();
    }
  };
  const backendBase = import.meta.env.VITE_BACKEND_BASE || '';
  const handleUrlSubmit=(e)=>{
    e.preventDefault();
    const url=inputUrl.trim(); if(!url) return;
    if(isYouTubeUrl(url)){
      const ts = Date.now();
      const base = backendBase || '';
      const proxied = `${base}/api/youtube?url=${encodeURIComponent(url)}&ts=${ts}`;
      // Prefetch to Blob to avoid decode/range/CORS quirks across browsers
      setStatus("Loading from YouTube…");
      fetch(proxied)
        .then(async(r)=>{
          if(!r.ok) throw new Error(`HTTP ${r.status}`);
          const blob=await r.blob();
          const obj=URL.createObjectURL(blob);
          attachAudio(obj); setHasAudio(true); setStatus('Ready. Hit Play ▶');
        })
        .catch(()=> setStatus('Failed to load YouTube audio. Try again.'));
      return;
    }
    attachAudio(url); setHasAudio(true);
  };

  // Auto-run: if VITE_AUTORUN=1, auto load and attempt to play a given test URL
  useEffect(()=>{
    const autorun = import.meta.env.VITE_AUTORUN === '1';
    if(!autorun) return;
    const backendBase = import.meta.env.VITE_BACKEND_BASE || '';
    const testUrl = import.meta.env.VITE_TEST_URL || inputUrl || "https://www.youtube.com/watch?v=tFZ5zs0vVS0";
    if(!testUrl) return;
    setInputUrl(testUrl);
    if(isYouTubeUrl(testUrl)){
      const ts = Date.now();
      const base = backendBase || '';
      const proxied = `${base}/api/youtube?url=${encodeURIComponent(testUrl)}&ts=${ts}`;
      setStatus("Loading from YouTube…");
      fetch(proxied)
        .then(async(r)=>{
          if(!r.ok) throw new Error(`HTTP ${r.status}`);
          const blob=await r.blob();
          const obj=URL.createObjectURL(blob);
          attachAudio(obj); setHasAudio(true); setStatus('Ready. Hit Play ▶');
          // Try autoplay with fallback
          setTimeout(()=>{ handlePlayPause(); }, 300);
        })
        .catch(()=> setStatus('Failed to load YouTube audio. Try again.'));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  return (
    <div className="relative min-h-screen w-full overflow-hidden">
      <canvas ref={canvasRef} className="bg-canvas" />
      <div className="flex items-center justify-center min-h-screen px-4">
        <div className={`vn-card ${uiHidden ? "hidden-card" : ""} backdrop-blur-xl bg-white/10 border border-white/15 shadow-2xl rounded-3xl w-full max-w-3xl p-8 text-white`}>
          <div className="text-center mb-6">
            <h1 className="vn-title text-5xl md:text-6xl font-black tracking-tight">
              <span className="video">VIDEO</span>{" "}
              <span className="noise">NOISE</span>
            </h1>
            <p className="opacity-80 mt-2 text-sm">Upload an mp3/wav or paste a YouTube link — audio will drive the visuals</p>
          </div>

          <form onSubmit={handleUrlSubmit}>
            <div className="relative">
              <input
                type="text"
                placeholder="Paste direct audio URL (mp3/ogg/wav) or YouTube link"
                value={inputUrl}
                onChange={(e)=>setInputUrl(e.target.value)}
                className="w-full rounded-2xl bg-white/10 border border-white/20 backdrop-blur-md px-5 py-4 pr-32 text-white placeholder-white/60 focus:outline-none focus:ring-4 focus:ring-fuchsia-400/30"
              />
              <button type="submit" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-white/20 hover:bg-white/30 border border-white/30 px-4 py-2 text-sm">Load</button>
            </div>
          </form>

          <div className="mt-4 controls-row">
            <label className="flex items-center justify-center gap-2 rounded-xl bg-white/10 border border-white/20 py-3 px-4 cursor-pointer grower">
              <input type="file" accept="audio/*" className="hidden" onChange={(e)=> e.target.files?.[0] && loadLocalFile(e.target.files[0])} />
              <span>Upload Audio</span>
            </label>

            <div className="flex items-center justify-between rounded-xl bg-white/10 border border-white/20 px-3 py-2 grower min-w-[260px]">
              <span className="text-sm opacity-80">Visual Theme</span>
              <select value={theme} onChange={(e)=>setTheme(e.target.value)} className="bg-transparent focus:outline-none w-44 md:w-56">
                {THEMES.map(t=>(<option key={t.id} value={t.id}>{t.name}</option>))}
              </select>
            </div>

            <button onClick={handlePlayPause} disabled={!hasAudio} className="rounded-xl bg-white/20 hover:bg-white/30 border border-white/30 px-5 py-3">
              {isPlaying ? "Pause" : "Play"}
            </button>

            <span className="text-white/70 text-sm grower">{status}</span>
          </div>

          {/* Monochrome Wave settings */}
          {theme==="mono-wave" && (
            <div className="mt-4 rounded-2xl border border-white/20 bg-white/5 p-4">
              <div className="text-sm mb-3 opacity-80">Monochrome Wave – Settings</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs opacity-80">Smoothness ({(smoothness*256|0)})</label>
                  <input type="range" min="0" max="1" step="0.01" value={smoothness}
                    onChange={(e)=>setSmoothness(parseFloat(e.target.value))} className="w-full" />
                </div>
                <div>
                  <label className="text-xs opacity-80">Wave Height ({waveHeight.toFixed(2)}x)</label>
                  <input type="range" min="0.5" max="3" step="0.01" value={waveHeight}
                    onChange={(e)=>setWaveHeight(parseFloat(e.target.value))} className="w-full" />
                </div>
                <div>
                  <label className="text-xs opacity-80">Wave Length ({waveLength.toFixed(2)}x)</label>
                  <input type="range" min="0.5" max="3" step="0.01" value={waveLength}
                    onChange={(e)=>setWaveLength(parseFloat(e.target.value))} className="w-full" />
                </div>
                <div>
                  <label className="text-xs opacity-80">Line Thickness ({lineThickness}px)</label>
                  <input type="range" min="1" max="7" step="1" value={lineThickness}
                    onChange={(e)=>setLineThickness(parseInt(e.target.value))} className="w-full" />
                </div>
              </div>

              <div className="mt-3 flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs opacity-80 cursor-pointer">
                  <input type="checkbox" checked={cleanMode} onChange={(e)=>setCleanMode(e.target.checked)} />
                  Clean Mode (EMA + Cubic + HiDPI)
                </label>
                <div className="flex-1">
                  <label className="text-xs opacity-80">Glow Intensity</label>
                  <input type="range" min="0" max="1" step="0.01" value={glowIntensity} onChange={(e)=>setGlowIntensity(parseFloat(e.target.value))} className="w-full" />
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs opacity-80 mb-2">Colors (Low | High)</div>
                <div className="flex flex-wrap gap-3">
                  {palettes.map(p=>(
                    <button key={p.id} onClick={()=>setPaletteId(p.id)} title={p.name}
                      className={`w-10 h-10 rounded-full border ${paletteId===p.id?'border-white':'border-white/40'} shadow`}
                      style={{background:`linear-gradient(90deg, ${p.low} 0 50%, ${p.high} 50% 100%)`}} />
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Galaxy settings */}
          {theme==="space-galaxy" && (
            <div className="mt-4 rounded-2xl border border-white/20 bg-white/5 p-4">
              <div className="text-sm mb-3 opacity-80">Galaxy Settings</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs opacity-80">Rotation Speed ({galaxySpeed.toFixed(2)}x)</label>
                  <input type="range" min="0.2" max="3" step="0.01" value={galaxySpeed}
                    onChange={(e)=>setGalaxySpeed(parseFloat(e.target.value))} className="w-full" />
                </div>
                <div>
                  <label className="text-xs opacity-80">Planet Size ({planetScale.toFixed(2)}x)</label>
                  <input type="range" min="0.5" max="2.5" step="0.01" value={planetScale}
                    onChange={(e)=>setPlanetScale(parseFloat(e.target.value))} className="w-full" />
                </div>
                <div>
                  <label className="text-xs opacity-80">Orbits ({galaxyRings})</label>
                  <input type="range" min="1" max="12" step="1" value={galaxyRings}
                    onChange={(e)=>setGalaxyRings(parseInt(e.target.value))} className="w-full" />
                </div>
                <div>
                  <label className="text-xs opacity-80">Planets / Orbit ({planetsPer})</label>
                  <input type="range" min="1" max="16" step="1" value={planetsPer}
                    onChange={(e)=>setPlanetsPer(parseInt(e.target.value))} className="w-full" />
                </div>
              </div>
              <div className="mt-3">
                <label className="text-xs opacity-80">Glow Intensity</label>
                <input type="range" min="0" max="1" step="0.01" value={galaxyGlow}
                  onChange={(e)=>setGalaxyGlow(parseFloat(e.target.value))} className="w-full" />
              </div>
            </div>
          )}

          <div onDrop={handleFileDrop} onDragOver={(e)=>e.preventDefault()} className="mt-4 rounded-2xl border border-dashed border-white/30 p-6 text-center text-white/80 min-h-[200px] flex items-center justify-center">
            Drag & drop audio file here
          </div>
          <div className="text-center text-white/60 text-xs mt-3">created by Oğuzhan Işık & Hasan Işık</div>

          <audio ref={audioRef} className="hidden" controls playsInline />
        </div>
      </div>
    </div>
  );
}
