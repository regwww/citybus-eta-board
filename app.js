// 香港交通到站顯示板 — Multi-operator ETA Board
// Operators: 城巴 CTB / 九巴 KMB / 港鐵巴士 MTR Bus / 輕鐵 LRT / 港鐵 MTR
// All APIs are CORS-enabled (Access-Control-Allow-Origin: *). Pure static, no backend.

// ===================== utils =====================
const HK_OFFSET_MIN = 8 * 60;
function pad(n){return String(n).padStart(2,"0")}
function fmtClock(){ const d=new Date(Date.now()+HK_OFFSET_MIN*60000); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }
function fmtHM(iso){ const dt=new Date(iso); if(isNaN(dt)) return "--"; const hk=new Date(dt.getTime()+HK_OFFSET_MIN*60000); return `${pad(hk.getUTCHours())}:${pad(hk.getUTCMinutes())}`; }
function relMinutes(iso){ const dt=new Date(iso); if(isNaN(dt)) return NaN; return Math.round((dt.getTime()-Date.now())/60000); }
function minsText(mins){ if(isNaN(mins)) return "--"; if(mins<0) return "已開出"; if(mins===0) return "即將到達"; if(mins<60) return `${mins} 分鐘`; const h=Math.floor(mins/60),m=mins%60; return `${h} 小時 ${m} 分`; }
function haversine(lat1,lon1,lat2,lon2){ const R=6371e3,toRad=x=>x*Math.PI/180,dLat=toRad(lat2-lat1),dLon=toRad(lon2-lon1),a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2; return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a)); }
function fmtDist(m){return m<1000? `${Math.round(m)} m` : `${(m/1000).toFixed(2)} km`}
const $ = (id)=>document.getElementById(id);

async function getJSON(url, opts={}, timeoutMs=15000){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    for(let attempt=0;attempt<2;attempt++){
      try{ const r=await fetch(url,{...opts,signal:ctrl.signal}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()); }
      catch(e){ if(attempt===1) throw e; await new Promise(res=>setTimeout(res,800)); }
    }
  }finally{ clearTimeout(t); }
}
async function postJSON(url, body, timeoutMs=15000){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),timeoutMs);
  try{
    for(let attempt=0;attempt<2;attempt++){
      try{ const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:ctrl.signal}); if(!r.ok) throw new Error(`HTTP ${r.status}`); return (await r.json()); }
      catch(e){ if(attempt===1) throw e; await new Promise(res=>setTimeout(res,800)); }
    }
  }finally{ clearTimeout(t); }
}

// ===================== state =====================
const state = {
  operator: "ctb",
  mode: "board",
  selections: {
    ctb:    { route:"B3X", dir:"outbound", stop:"003192" },
    kmb:    { route:"267X", dir:"outbound", serviceType:"1", stop:"FA553D19AD960A9B" },
    mtrbus: { routes:["K51","K51A"], stops:{K51:"K51-D230", K51A:"K51A-D210"} },
    lrt:    { station:"330" },
    mtr:    { line:"TML", station:"SIH" },
  },
  data: {},      // loaded JSON datasets
  cache: {},     // route-stop caches
  selectedNearby: null,
  timer: null,
  boardToken: 0, // in-flight guard for async board loads
  detailToken: 0, // in-flight guard for async stop-detail loads
};

// ===================== OPERATOR ADAPTERS =====================
const CTB_API="https://rt.data.gov.hk/v2/transport/citybus";
const CTB_BATCH="https://rt.data.gov.hk/v1/transport/batch/stop-eta/ctb";
const KMB_API="https://data.etabus.gov.hk/v1/transport/kmb";
const MTRBUS_API="https://rt.data.gov.hk/v1/transport/mtr/bus/getSchedule";
const LRT_API="https://rt.data.gov.hk/v1/transport/mtr/lrt/getSchedule";
const MTR_API="https://rt.data.gov.hk/v1/transport/mtr/getSchedule.php";

const OPERATORS = {
  ctb: {
    label:"城巴", selectorKind:"route-dir-stop",
    async ensureData(){ if(state.data.ctb) return; const [s,r]=await Promise.all([fetch("stops_db.json").then(r=>r.json()),fetch("routes_dest.json").then(r=>r.json())]); state.data.ctb={stops:s,routes:r}; },
    nearbyIndex(){ const s=state.data.ctb.stops; return Object.values(s).filter(x=>x.lat&&x.long).map(x=>({...x,id:x.id||x.stop,provider:"ctb"})); },
    async loadBoard(sel){ const d=state.data.ctb; let stopName=d.stops[sel.stop]?{tc:d.stops[sel.stop].name_tc,en:d.stops[sel.stop].name_en}:{tc:sel.stop,en:""};
      let etas=[]; try{ etas=(await getJSON(`${CTB_API}/eta/ctb/${sel.stop}/${sel.route}`)).data||[]; }catch(e){ etas=[]; }
      const dest=etas[0]?(etas[0].dest_tc||""):(d.routes[sel.route]?d.routes[sel.route][sel.dir==="outbound"?"O":"I"]:"");
      const valid=etas.filter(e=>e.eta).slice(0,3);
      return { provider:"ctb", title:stopName.tc, subtitle:stopName.en, badge:sel.route, destination:dest, groups:[{label:sel.route,sublabel:`往 ${dest}`,etas:valid.map((e,i)=>({seq:i+1,clock:fmtHM(e.eta),minutesText:minsText(relMinutes(e.eta)),minutes:relMinutes(e.eta),remark:e.rmk_tc||"",raw:e}))}] }; },
    async loadStopDetail(stop){ let groups=[]; try{ const data=(await getJSON(`${CTB_BATCH}/ctb/${stop.id}`)).data||[]; const map={}; data.forEach(e=>{const k=e.route+"|"+e.dir;(map[k]=map[k]||[]).push(e);}); groups=Object.entries(map).map(([k,arr])=>{const [route,dir]=k.split("|");let dest=state.data.ctb.routes[route]?state.data.ctb.routes[route][dir]||"":"";arr.sort((a,b)=>a.eta_seq-b.eta_seq);return {label:route,sublabel:`往 ${dest}`,etas:arr.slice(0,3).map((e,i)=>({seq:i+1,clock:fmtHM(e.eta),minutesText:minsText(relMinutes(e.eta)),minutes:relMinutes(e.eta),remark:e.rmk_tc||"",raw:e}))};}).sort((a,b)=>a.label.localeCompare(b.label,"en",{numeric:true})); }catch(e){ groups=[]; }
      const sn=state.data.ctb.stops[stop.id]||{}; return {provider:"ctb",title:sn.name_tc||stop.id,subtitle:sn.name_en||"",badge:stop.id,destination:"",groups}; },
    async getRouteStops(route,dir){ const key=`ctb:${route}:${dir}`; if(state.cache[key]) return state.cache[key]; try{ const d=await getJSON(`${CTB_API}/route-stop/ctb/${route}/${dir}`); state.cache[key]=(d.data||[]).map(s=>({stop:s.stop,seq:s.seq})); }catch(e){ state.cache[key]=[]; } return state.cache[key]; },
    async stopName(stopId){ if(state.data.ctb.stops[stopId]) return state.data.ctb.stops[stopId]; try{ const d=await getJSON(`${CTB_API}/stop/${stopId}`); return d.data||{}; }catch(e){ return {}; } },
  },

  kmb: {
    label:"九巴", selectorKind:"route-dir-stop",
    async ensureData(){ if(state.data.kmb) return; const [s,r]=await Promise.all([fetch("kmb_stops.json").then(r=>r.json()),fetch("kmb_routes.json").then(r=>r.json())]); state.data.kmb={stops:s,routes:r}; },
    nearbyIndex(){ const s=state.data.kmb.stops; return Object.values(s).filter(x=>x.lat&&x.long).map(x=>({...x,id:x.id,provider:"kmb"})); },
    async loadBoard(sel){ const d=state.data.kmb; const sn=d.stops[sel.stop]||{name_tc:sel.stop};
      let etas=[]; try{ etas=(await getJSON(`${KMB_API}/eta/${sel.stop}/${sel.route}/${sel.serviceType}`)).data||[]; }catch(e){ etas=[]; }
      const dest=etas[0]?(etas[0].dest_tc||""):(d.routes[sel.route]?d.routes[sel.route][sel.dir].dest_tc||"":"");
      const valid=etas.filter(e=>e.eta).slice(0,3);
      return { provider:"kmb", title:sn.name_tc||sel.stop, subtitle:sn.name_en||"", badge:sel.route, destination:dest, groups:[{label:sel.route,sublabel:`往 ${dest}`,etas:valid.map((e,i)=>({seq:i+1,clock:fmtHM(e.eta),minutesText:minsText(relMinutes(e.eta)),minutes:relMinutes(e.eta),remark:"",raw:e}))}] }; },
    async loadStopDetail(stop){ let groups=[]; try{ const data=(await getJSON(`${KMB_API}/stop-eta/${stop.id}`)).data||[]; const map={}; data.forEach(e=>{const k=e.route+"|"+e.dir+"|"+(e.service_type||1);(map[k]=map[k]||[]).push(e);}); groups=Object.entries(map).map(([k,arr])=>{const [route,dir]=k.split("|");arr.sort((a,b)=>a.eta_seq-b.eta_seq);let dest=arr[0]?(arr[0].dest_tc||""):"";return {label:route,sublabel:`往 ${dest}`,dest,etas:arr.filter(e=>e.eta).slice(0,3).map((e,i)=>({seq:i+1,clock:fmtHM(e.eta),minutesText:minsText(relMinutes(e.eta)),minutes:relMinutes(e.eta),remark:"",raw:e}))};}).sort((a,b)=>a.label.localeCompare(b.label,"en",{numeric:true}));
      // de-dupe groups with identical route+destination (different service types) — keep the soonest
      const seen={}; groups=groups.filter(g=>{const key=g.label+"|"+g.dest; if(seen[key])return false; seen[key]=true; return true; });
      }catch(e){ groups=[]; }
      const sn=state.data.kmb.stops[stop.id]||{}; return {provider:"kmb",title:sn.name_tc||stop.id,subtitle:sn.name_en||"",badge:stop.id,destination:"",groups}; },
    async getRouteStops(route,dir,serviceType){ const key=`kmb:${route}:${dir}:${serviceType}`; if(state.cache[key]) return state.cache[key]; try{ const d=await getJSON(`${KMB_API}/route-stop/${route}/${dir}/${serviceType}`); state.cache[key]=(d.data||[]).map(s=>({stop:s.stop,seq:s.seq})); }catch(e){ state.cache[key]=[]; } return state.cache[key]; },
    serviceTypeFor(route,dir){ const r=state.data.kmb.routes[route]; return r? (r[dir]||{}).service_type||"1":"1"; },
  },

  mtrbus: {
    label:"港鐵巴士", selectorKind:"mtrbus",
    async ensureData(){ if(state.data.mtrbus) return; const [s,dst]=await Promise.all([fetch("mtr_bus_stops.json").then(r=>r.json()),fetch("mtr_bus_dest.json").then(r=>r.json())]); state.data.mtrbus={stops:s,dest:dst}; },
    nearbyIndex(){ const s=state.data.mtrbus.stops; return Object.values(s).filter(x=>x.lat&&x.long).map(x=>({...x,id:x.id,provider:"mtrbus"})); },
    async loadBoard(sel){ const d=state.data.mtrbus; const groups=[];
      for(const route of sel.routes){ try{ const resp=await postJSON(MTRBUS_API,{language:"zh",routeName:route},45000); const bs=resp.busStop||[]; const stopId=sel.stops[route]; const b=bs.find(x=>x.busStopId===stopId); const stopName=d.stops[stopId]||{};
        const dirs=d.stops[stopId]&&d.stops[stopId].routes[route]; const dir=dirs?dirs[0]:"I"; const dst=(d.dest[`${route}-${dir}`]||{}).dest_tc||"";
        if(b){ const etas=(b.bus||[]).map(bus=>{ const secs=(bus.arrivalTimeInSecond==="108000"||!bus.arrivalTimeInSecond)?bus.departureTimeInSecond:bus.arrivalTimeInSecond; const mins=Math.round(secs/60); return {seq:0,clock:"",minutesText:bus.departureTimeText||minsText(mins),minutes:mins,remark:bus.isDelayed==="1"?"延遲":"",raw:bus}; }).filter(e=>e.minutes!==Infinity&&!isNaN(e.minutes)); groups.push({label:route,sublabel:dst?`往 ${dst}`:"",etas:etas.slice(0,3).map((e,i)=>({...e,seq:i+1}))}); } }
        catch(e){} }
      const firstStopId=sel.stops[sel.routes[0]]; const sn=d.stops[firstStopId]||{};
      return {provider:"mtrbus",title:sn.name_tc||"港鐵巴士",subtitle:sn.name_en||"",badge:sel.routes.join("/"),destination:"",groups}; },
    async loadStopDetail(stop){ // stop has .routes {route:[dirs]} and .id
      const d=state.data.mtrbus; const groups=[];
      for(const route of Object.keys(stop.routes)){ try{ const resp=await postJSON(MTRBUS_API,{language:"zh",routeName:route},45000); const bs=resp.busStop||[]; const b=bs.find(x=>x.busStopId===stop.id);
        const dir=(stop.routes[route]||["I"])[0]; const dst=(d.dest[`${route}-${dir}`]||{}).dest_tc||"";
        if(b){ const etas=(b.bus||[]).map(bus=>{ const secs=(bus.arrivalTimeInSecond==="108000"||!bus.arrivalTimeInSecond)?bus.departureTimeInSecond:bus.arrivalTimeInSecond; const mins=Math.round(secs/60); return {seq:0,clock:"",minutesText:bus.departureTimeText||minsText(mins),minutes:mins,remark:bus.isDelayed==="1"?"延遲":"",raw:bus}; }).filter(e=>!isNaN(e.minutes)); groups.push({label:route,sublabel:dst?`往 ${dst}`:"",etas:etas.slice(0,3).map((e,i)=>({...e,seq:i+1}))}); } }
        catch(e){} }
      return {provider:"mtrbus",title:stop.name_tc||stop.id,subtitle:stop.name_en||"",badge:stop.id,destination:"",groups}; },
  },

  lrt: {
    label:"輕鐵", selectorKind:"station",
    async ensureData(){ if(state.data.lrt) return; state.data.lrt={stations:await fetch("lrt_stations.json").then(r=>r.json())}; },
    nearbyIndex(){ const s=state.data.lrt.stations; return Object.values(s).filter(x=>x.lat&&x.long).map(x=>({...x,id:x.id,provider:"lrt"})); },
    async loadBoard(sel){ let groups=[]; try{ const resp=await getJSON(`${LRT_API}?station_id=${sel.station}`); const pls=resp.platform_list||[];
      pls.forEach(pl=>{ (pl.route_list||[]).forEach(rl=>{ groups.push({label:rl.route_no,sublabel:`往 ${rl.dest_ch||""}`,platform:`月台 ${pl.platform_id}`,etas:[{seq:1,clock:"",minutesText:rl.time_ch||"--",minutes:NaN,remark:(rl.arrival_departure==="D"?"開出":"到達")+(rl.train_length?` · ${rl.train_length} 卡`:""),raw:rl}]}); }); }); }catch(e){ groups=[]; }
      const sn=state.data.lrt.stations[sel.station]||{}; return {provider:"lrt",title:sn.name_tc||sel.station,subtitle:sn.name_en||"",badge:"輕鐵",destination:"",groups}; },
    async loadStopDetail(stop){ return OPERATORS.lrt.loadBoard({station:stop.id}); },
  },

  mtr: {
    label:"港鐵", selectorKind:"line-station",
    async ensureData(){ if(state.data.mtr) return; const [s,l]=await Promise.all([fetch("mtr_stations.json").then(r=>r.json()),fetch("mtr_lines.json").then(r=>r.json())]); state.data.mtr={stations:s,lines:l}; },
    nearbyIndex(){ const s=state.data.mtr.stations; return Object.values(s).filter(x=>x.lat&&x.long).map(x=>({...x,id:x.code,provider:"mtr",lines:state.data.mtr.lines.station2lines[x.code]||[]})); },
    async loadBoard(sel){ let groups=[]; try{ const resp=await getJSON(`${MTR_API}?line=${sel.line}&sta=${sel.station}`); const key=`${sel.line}-${sel.station}`; const data=(resp.data||{})[key]||{};
      [["UP","上行"],["DOWN","下行"]].forEach(([d,label])=>{ const arr=data[d]||[]; if(!arr.length) return; const first=arr[0]; const destName=state.data.mtr.stations[first.dest]?state.data.mtr.stations[first.dest].name_tc:first.dest; groups.push({label:label,sublabel:`往 ${destName}`,platform:first.plat?`月台 ${first.plat}`:"",etas:arr.slice(0,3).map((e,i)=>({seq:i+1,clock:(e.time||"").slice(11,16),minutesText:e.ttnt?`${e.ttnt} 分鐘`:"--",minutes:e.ttnt?parseInt(e.ttnt):NaN,remark:"",raw:e}))}); }); }catch(e){ groups=[]; }
      const sn=state.data.mtr.stations[sel.station]||{}; return {provider:"mtr",title:sn.name_tc||sel.station,subtitle:sn.name_en||"",badge:sel.line,destination:"",groups}; },
    async loadStopDetail(stop){ // stop has .lines[]; fetch first line's schedule
      const line=(stop.lines&&stop.lines[0])||"TML"; return OPERATORS.mtr.loadBoard({line,station:stop.id}); },
  },
};

// ===================== RENDER (shared) =====================
function renderBoard(payload){
  $("routeBadge").textContent=payload.badge;
  $("destName").textContent=payload.destination||"";
  $("destEn").textContent=""; 
  $("stopName").textContent=payload.title||payload.badge;
  $("stopSub").textContent=payload.subtitle||"";
  const cards=$("etaCards"); cards.innerHTML="";
  if(!payload.groups.length||payload.groups.every(g=>!g.etas.length)){ cards.innerHTML=`<div class="eta-card empty">暫時沒有班次資料</div>`; }
  else{
    payload.groups.forEach(g=>{
      if(!g.etas.length) return;
      const card=document.createElement("div"); card.className="eta-card next";
      const seqLabel=["下一班","第二班","第三班"];
      const etaHtml=g.etas.map((e,i)=>{ const soon=e.minutes!==undefined&&e.minutes<=0; return `<div class="eta-row"><span class="eta-seq">${seqLabel[i]||""}</span>${e.clock?`<span class="eta-clock">${e.clock}</span>`:""}<span class="eta-mins${soon?" soon":""}">${e.minutesText}</span>${e.remark?`<span class="eta-rmk">${e.remark}</span>`:""}</div>`; }).join("");
      card.innerHTML=`<div class="grp-head"><span class="route-badge">${g.label}</span>${g.sublabel?`<span class="grp-dest">${g.sublabel}</span>`:""}${g.platform?`<span class="grp-plat">${g.platform}</span>`:""}</div><div class="grp-etas">${etaHtml}</div>`;
      cards.appendChild(card);
    });
  }
  $("updated").textContent=`更新時間：${fmtClock()}`;
}
function renderNearbyList(arr){
  const list=$("stopList"); list.innerHTML="";
  if(!arr.length){ list.innerHTML=`<div class="eta-card empty">附近沒有找到車站</div>`; return; }
  const pin=`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  arr.forEach(s=>{ const item=document.createElement("div"); item.className="stop-item";
    item.innerHTML=`<span class="pin">${pin}</span><span class="info"><span class="nm">${s.name_tc||s.id}</span><span class="en">${s.name_en||""}</span></span><span class="dist">${fmtDist(s.dist)}</span>`;
    item.onclick=()=>openStopDetail(s); list.appendChild(item); });
}
function renderStopDetail(payload){ const wrap=$("detailEtaCards"); wrap.innerHTML=""; 
  if(!payload.groups.length||payload.groups.every(g=>!g.etas.length)){ wrap.innerHTML=`<div class="eta-card empty">暫時沒有班次資料</div>`; }
  payload.groups.forEach(g=>{ if(!g.etas.length) return; const card=document.createElement("div"); card.className="eta-card next";
    const seqLabel=["下一班","第二班","第三班"];
    const etaHtml=g.etas.map((e,i)=>`<div class="eta-row"><span class="eta-seq">${seqLabel[i]||""}</span>${e.clock?`<span class="eta-clock">${e.clock}</span>`:""}<span class="eta-mins">${e.minutesText}</span>${e.remark?`<span class="eta-rmk">${e.remark}</span>`:""}</div>`).join("");
    card.innerHTML=`<div class="grp-head"><span class="route-badge">${g.label}</span>${g.sublabel?`<span class="grp-dest">${g.sublabel}</span>`:""}${g.platform?`<span class="grp-plat">${g.platform}</span>`:""}</div><div class="grp-etas">${etaHtml}</div>`;
    wrap.appendChild(card); });
  $("detailUpdated").textContent=`更新時間：${fmtClock()}`;
}

// ===================== BOARD MODE =====================
async function loadBoard(){
  const op=state.operator, sel=state.selections[op], adapter=OPERATORS[op];
  const token=++state.boardToken;
  if(state.lastRenderedOp!==op){ $("etaCards").innerHTML=`<div class="eta-card empty"><span class="loader"></span> 載入中…</div>`; }
  try{ await adapter.ensureData(); const payload=await adapter.loadBoard(sel);
    if(token!==state.boardToken) return; // stale: user switched operator
    renderBoard(payload); state.lastRenderedOp=op; }
  catch(e){ if(token!==state.boardToken) return; console.error("loadBoard",op,e); $("etaCards").innerHTML=`<div class="eta-card empty">載入失敗，請稍後重試</div>`; }
}
async function refreshBoard(){ $("refreshBtn").classList.add("spinning"); try{await loadBoard();}catch(e){}finally{$("refreshBtn").classList.remove("spinning");} }
function startAutoRefresh(){ stopAutoRefresh(); state.timer=setInterval(refreshBoard,60000); }
function stopAutoRefresh(){ if(state.timer){clearInterval(state.timer);state.timer=null;} }

// ===================== NEARBY MODE =====================
function locateAndShow(){
  const op=state.operator;
  $("nearbyHint").textContent="正在定位…"; $("nearbyHint").classList.add("hint");
  $("stopList").innerHTML=`<div style="text-align:center;padding:30px"><span class="loader"></span><div style="color:var(--muted);margin-top:10px;font-size:14px">搜尋附近${OPERATORS[op].label}站…</div></div>`;
  if(!navigator.geolocation){ $("nearbyHint").textContent="此裝置不支援定位功能。"; $("stopList").innerHTML=""; return; }
  navigator.geolocation.getCurrentPosition(pos=>onLocate(pos),err=>onLocateError(err),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
}
async function onLocate(pos){
  const {latitude,longitude}=pos.coords; const op=state.operator;
  $("nearbyHint").textContent=`你的位置：${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  try{ await OPERATORS[op].ensureData(); const idx=OPERATORS[op].nearbyIndex();
    const arr=idx.map(s=>({...s,dist:haversine(latitude,longitude,s.lat,s.long)})).sort((a,b)=>a.dist-b.dist).slice(0,12);
    renderNearbyList(arr); }catch(e){ $("stopList").innerHTML=`<div class="eta-card empty">載入車站資料失敗</div>`; }
}
function onLocateError(err){ $("nearbyHint").textContent="無法取得定位："+(err.message||"請允許瀏覽器使用定位"); $("stopList").innerHTML=""; }

// ===================== STOP DETAIL =====================
async function openStopDetail(stop){ state.selectedNearby=stop; switchView("stop-detail");
  $("detailStopName").textContent=stop.name_tc||stop.id; $("detailStopSub").textContent=stop.name_en||"";
  $("detailEtaCards").innerHTML=`<div style="text-align:center;padding:30px"><span class="loader"></span></div>`;
  await loadStopDetail(); startDetailRefresh(); }
function startDetailRefresh(){ stopDetailRefresh(); state.detailTimer=setInterval(loadStopDetail,60000); }
function stopDetailRefresh(){ if(state.detailTimer){clearInterval(state.detailTimer);state.detailTimer=null;} }
async function loadStopDetail(){ const stop=state.selectedNearby; if(!stop) return; const token=++state.detailToken;
  try{ const p=await OPERATORS[state.operator].loadStopDetail(stop); if(token!==state.detailToken) return; renderStopDetail(p); }catch(e){ if(token!==state.detailToken) return; $("detailEtaCards").innerHTML=`<div class="eta-card empty">載入失敗</div>`; } }

// ===================== SETTINGS PANEL (operator-specific) =====================
function openSettings(){ $("overlay").hidden=false; $("settingsPanel").classList.add("open"); $("settingsPanel").setAttribute("aria-hidden","false"); renderSettings(); }
function closeSettings(){ $("overlay").hidden=true; $("settingsPanel").classList.remove("open"); $("settingsPanel").setAttribute("aria-hidden","true"); }
async function renderSettings(){
  const op=state.operator, sel=state.selections[op], kind=OPERATORS[op].selectorKind, body=$("settingsBody");
  if(kind==="route-dir-stop"){
    body.innerHTML=`<div class="set-row"><label>路線</label><input id="routeInput" list="routeList" value="${sel.route||""}" placeholder="例如 B3X"></div><datalist id="routeList"></datalist>
      <div class="set-row dir-row"><label>方向</label><div class="dir-btns"><button class="dir-btn ${sel.dir==="outbound"?"active":""}" data-dir="outbound">去程</button><button class="dir-btn ${sel.dir==="inbound"?"active":""}" data-dir="inbound">回程</button></div></div>
      <div class="set-row"><label>車站</label><select id="stopSelect"></select></div>`;
    if(op==="ctb"&&state.data.ctb){ populateRouteList(Object.keys(state.data.ctb.routes)); }
    if(op==="kmb"&&state.data.kmb){ populateRouteList(Object.keys(state.data.kmb.routes)); }
    const dirBtns=body.querySelectorAll(".dir-btn"); dirBtns.forEach(b=>b.addEventListener("click",()=>{dirBtns.forEach(x=>x.classList.remove("active"));b.classList.add("active");loadDirStops(b.dataset.dir);}));
    const routeInput=body.querySelector("#routeInput"); routeInput.addEventListener("change",()=>{ const dir=body.querySelector(".dir-btn.active").dataset.dir; loadDirStops(dir); });
    loadDirStops(sel.dir);
  } else if(kind==="mtrbus"){
    body.innerHTML=`<div class="set-row"><label>路線（多個以逗號分隔）</label><input id="routeInputMtr" value="${(sel.routes||[]).join(",")}" placeholder="K51,K51A"></div><div class="set-row"><label>站點 ID（每路線一個）</label><textarea id="stopsInput" rows="3" placeholder="K51:K51-D230"></textarea></div><p style="font-size:12px;color:var(--muted)">格式：路線:站點ID，每行一個</p>`;
  } else if(kind==="station"){
    await OPERATORS.lrt.ensureData(); const stas=state.data.lrt.stations;
    const arr=Object.values(stas).sort((a,b)=>(a.name_tc||"").localeCompare(b.name_tc||""));
    body.innerHTML=`<div class="set-row"><label>搜尋車站</label><input id="stationSearch" placeholder="輸入站名或編號" value="${(stas[sel.station]||{}).name_tc||sel.station}"></div><div id="stationList" class="station-list"></div>`;
    const search=body.querySelector("#stationSearch"); const list=body.querySelector("#stationList");
    const renderList=(q="")=>{ const f=arr.filter(s=>(s.name_tc||"").includes(q)||(s.name_en||"").toLowerCase().includes(q.toLowerCase())||(s.id||"").includes(q)).slice(0,40); list.innerHTML=f.map(s=>`<div class="station-opt${s.id===sel.station?" selected":""}" data-id="${s.id}">${s.name_tc||""} <span class="en">${s.name_en||""} · ${s.id}</span></div>`).join(""); list.querySelectorAll(".station-opt").forEach(o=>o.onclick=()=>{ sel.station=o.dataset.id; list.querySelectorAll(".station-opt").forEach(x=>x.classList.remove("selected")); o.classList.add("selected"); }); };
    search.addEventListener("input",()=>renderList(search.value)); renderList(search.value);
  } else if(kind==="line-station"){
    await OPERATORS.mtr.ensureData(); const L=state.data.mtr.lines;
    const lines=Object.keys(L.line2stations).sort();
    body.innerHTML=`<div class="set-row"><label>路線</label><select id="lineSelect">${lines.map(l=>`<option value="${l}" ${l===sel.line?"selected":""}>${l}</option>`).join("")}</select></div><div class="set-row"><label>車站</label><select id="stationSelect"></select></div>`;
    const lineSel=body.querySelector("#lineSelect"), staSel=body.querySelector("#stationSelect");
    const fillStations=()=>{ const cs=L.line2stations[lineSel.value]||[]; staSel.innerHTML=cs.map(c=>`<option value="${c}" ${c===sel.station?"selected":""}>${(L.stationNames[c]||{}).name_tc||c} · ${c}</option>`).join(""); };
    lineSel.addEventListener("change",fillStations); fillStations();
  }
}
function populateRouteList(routes){ const dl=$("routeList"); if(dl&&!dl.children.length){ routes.sort((a,b)=>a.localeCompare(b,"en",{numeric:true})).forEach(r=>{const o=document.createElement("option");o.value=r;dl.appendChild(o);}); } }
async function loadDirStops(dir){
  const op=state.operator, sel=state.selections[op], selEl=$("stopSelect"); if(!selEl) return;
  selEl.innerHTML=`<option>載入中…</option>`;
  let route=$("routeInput").value.trim().toUpperCase();
  let stops=[];
  if(op==="ctb"){ stops=await OPERATORS.ctb.getRouteStops(route,dir); }
  else if(op==="kmb"){ const st=OPERATORS.kmb.serviceTypeFor(route,dir); sel.serviceType=st; stops=await OPERATORS.kmb.getRouteStops(route,dir,st); }
  const items=await Promise.all(stops.map(async s=>{ let name=s.stop; const db=op==="ctb"?state.data.ctb.stops:state.data.kmb.stops; if(db&&db[s.stop]) name=db[s.stop].name_tc; return {stop:s.stop,seq:s.seq,name}; }));
  selEl.innerHTML=items.length?items.map(i=>`<option value="${i.stop}">${i.seq}. ${i.name}</option>`).join(""):`<option>沒有站點</option>`;
  if(sel.stop&&[...selEl.options].some(o=>o.value===sel.stop)) selEl.value=sel.stop;
}
async function applySettings(){
  const op=state.operator, sel=state.selections[op], kind=OPERATORS[op].selectorKind, body=$("settingsBody");
  if(kind==="route-dir-stop"){ const route=body.querySelector("#routeInput").value.trim().toUpperCase(); const dir=body.querySelector(".dir-btn.active").dataset.dir; const stop=body.querySelector("#stopSelect").value; if(!route){alert("請輸入路線號碼");return;} if(!stop){alert("請選擇車站");return;} sel.route=route;sel.dir=dir;sel.stop=stop; }
  else if(kind==="mtrbus"){ const routes=body.querySelector("#routeInputMtr").value.split(/[,\s]+/).filter(Boolean).map(r=>r.toUpperCase()); const lines=body.querySelector("#stopsInput").value.split("\n").map(l=>l.trim()).filter(Boolean); const stops={}; lines.forEach(l=>{const [r,s]=l.split(":").map(x=>x.trim()); if(r)stops[r.toUpperCase()]=s;}); sel.routes=routes;sel.stops=stops; }
  else if(kind==="station"){ /* sel.station already set by click */ }
  else if(kind==="line-station"){ sel.line=body.querySelector("#lineSelect").value; sel.station=body.querySelector("#stationSelect").value; }
  closeSettings(); await refreshBoard();
}

// ===================== OPERATOR SWITCH =====================
function switchOperator(op){
  stopAutoRefresh(); stopDetailRefresh(); state.operator=op; state.lastRenderedOp=null;
  document.querySelectorAll(".op-tab").forEach(t=>t.classList.toggle("active",t.dataset.op===op));
  $("opTitle").textContent=OPERATORS[op].label;
  // clear stale board content immediately so the old operator's data doesn't linger during load
  $("routeBadge").textContent=OPERATORS[op].label;
  $("stopName").textContent="載入中…"; $("stopSub").textContent=""; $("destName").textContent="";
  $("etaCards").innerHTML=`<div class="eta-card empty"><span class="loader"></span> 載入中…</div>`;
  setMode("board");
}
function switchView(name){ state.mode=name; document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  if(name==="board")$("boardView").classList.add("active"); else if(name==="nearby")$("nearbyView").classList.add("active"); else if(name==="stop-detail")$("stopDetailView").classList.add("active");
  document.querySelectorAll(".mode-btn").forEach(b=>b.classList.toggle("active",(name==="board"||name==="stop-detail")?b.dataset.mode==="board":b.dataset.mode==="nearby"));
}
function setMode(mode){ if(mode==="nearby"){ switchView("nearby"); stopAutoRefresh(); stopDetailRefresh(); } else { switchView("board"); stopDetailRefresh(); startAutoRefresh(); refreshBoard(); } }

// ===================== events =====================
document.querySelectorAll(".op-tab").forEach(t=>t.addEventListener("click",()=>switchOperator(t.dataset.op)));
document.querySelectorAll(".mode-btn").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
$("refreshBtn").addEventListener("click",refreshBoard);
$("settingsBtn").addEventListener("click",openSettings);
$("closeSettings").addEventListener("click",closeSettings);
$("overlay").addEventListener("click",closeSettings);
$("applySettings").addEventListener("click",applySettings);
$("locateBtn").addEventListener("click",locateAndShow);
$("backBtn").addEventListener("click",()=>setMode("nearby"));

// ===================== init =====================
(async function init(){
  try{ await OPERATORS.ctb.ensureData(); }catch(e){}
  $("clock").textContent=fmtClock();
  switchOperator("ctb");
  await refreshBoard(); startAutoRefresh();
})();
