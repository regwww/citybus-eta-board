// 城巴到站顯示板 — Citybus ETA Board
// Official open-data API: https://rt.data.gov.hk/v2/transport/citybus/
// CORS enabled (Access-Control-Allow-Origin: *) -> pure static, no backend.

const API = "https://rt.data.gov.hk/v2/transport/citybus";
const BATCH = "https://rt.data.gov.hk/v1/transport/batch/stop-eta";
const CO = "ctb";

// Default: 紅橋站, B3X outbound (屯門市中心 -> 深圳灣口岸)
const DEFAULT = { route: "B3X", dir: "outbound", stop: "003192" };

let state = {
  mode: "board",
  route: DEFAULT.route,
  dir: DEFAULT.dir,
  stop: DEFAULT.stop,
  stopsDb: null,        // {id: {name_tc,name_en,lat,long}}
  routesDest: null,     // {route: {O:dest_tc, I:orig_tc}}
  routeStops: null,     // cached {route: {outbound:[], inbound:[]}}
  nearbyStops: null,
  selectedStop: null,
  timer: null,
};

const $ = (id) => document.getElementById(id);

// ---------- utils ----------
// Hong Kong is UTC+8 with no daylight saving. Compute HK time from UTC directly
// so display is correct regardless of the device/browser timezone or ICU data.
const HK_OFFSET_MIN = 8 * 60;
function pad(n){return String(n).padStart(2,"0")}
function fmtClock(){ const d = new Date(Date.now() + HK_OFFSET_MIN*60000); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`; }
function fmtHM(iso){ const dt = new Date(iso); if(isNaN(dt)) return "--"; const hk = new Date(dt.getTime() + HK_OFFSET_MIN*60000); return `${pad(hk.getUTCHours())}:${pad(hk.getUTCMinutes())}`; }
function relMinutes(iso){ const dt = new Date(iso); if(isNaN(dt)) return NaN; return Math.round((dt.getTime()-Date.now())/60000); }
function haversine(lat1,lon1,lat2,lon2){
  const R=6371e3, toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function fmtDist(m){return m<1000? `${Math.round(m)} m` : `${(m/1000).toFixed(2)} km`}

async function getJSON(url, timeoutMs=12000){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs);
  try{
    for(let attempt=0; attempt<2; attempt++){
      try{
        const r = await fetch(url, {signal:ctrl.signal});
        if(!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        return j.data;
      }catch(e){
        if(attempt===1) throw e;
        await new Promise(res=>setTimeout(res, 800));
      }
    }
  }finally{ clearTimeout(t); }
}

// ---------- clock ----------
setInterval(()=>{ $("clock").textContent = fmtClock(); },1000);

// ---------- BOARD MODE ----------
async function loadBoard(){
  const {route, stop, dir} = state;
  // Stop name: prefer the local stops DB (no network); fall back to the stop API.
  let stopNameTC="", stopNameEN="";
  if(state.stopsDb && state.stopsDb[stop]){
    stopNameTC = state.stopsDb[stop].name_tc || "";
    stopNameEN = state.stopsDb[stop].name_en || "";
  }else{
    try{ const sd=await getJSON(`${API}/stop/${stop}`); if(sd){stopNameTC=sd.name_tc||"";stopNameEN=sd.name_en||"";} }catch(e){}
  }
  // Single ETA request — the response already carries the destination name.
  let etas=[], destTC="", destEN="";
  try{
    etas = await getJSON(`${API}/eta/${CO}/${stop}/${route}`) || [];
    if(etas.length){ destTC = etas[0].dest_tc || ""; destEN = etas[0].dest_en || ""; }
  }catch(e){ etas=[]; }
  // Fallback destination from the local route→destination map.
  if(!destTC && state.routesDest && state.routesDest[route]){
    destTC = state.routesDest[route][dir==="outbound"?"O":"I"] || "";
  }
  renderBoard({route, destTC, destEN, stopNameTC, stopNameEN, etas});
}

function renderBoard({route,destTC,destEN,stopNameTC,stopNameEN,etas}){
  $("routeBadge").textContent = route;
  $("destName").textContent = destTC || route;
  $("destEn").textContent = destEN || "";
  $("stopName").textContent = stopNameTC || state.stop;
  $("stopSub").textContent = stopNameEN || "";
  const cards = $("etaCards");
  cards.innerHTML = "";
  if(!etas.length){
    cards.innerHTML = `<div class="eta-card empty">暫時沒有班次資料</div>`;
  }else{
    const seqLabel = ["下一班","第二班","第三班"];
    etas.slice(0,3).forEach((e,i)=>{
      const mins = relMinutes(e.eta);
      let minsText, soon=false;
      if(isNaN(mins)){ minsText="--"; }
      else if(mins<=0){ minsText="即將到達"; soon=true; }
      else if(mins<60){ minsText=`${mins} 分鐘`; }
      else{ const h=Math.floor(mins/60), m=mins%60; minsText=`${h} 小時 ${m} 分`; }
      const etaTime = fmtHM(e.eta);
      const card = document.createElement("div");
      card.className = "eta-card" + (i===0?" next":"");
      card.innerHTML = `
        <div class="eta-seq">${seqLabel[i]||""}</div>
        <div class="eta-time">${etaTime}</div>
        <div class="eta-mins${soon?" soon":""}">${minsText}</div>
        <div class="eta-rmk">${e.rmk_tc||""}</div>`;
      cards.appendChild(card);
    });
  }
  $("updated").textContent = `更新時間：${fmtClock()}`;
}

async function refreshBoard(){
  $("refreshBtn").classList.add("spinning");
  try{ await loadBoard(); }
  catch(e){ $("etaCards").innerHTML = `<div class="eta-card empty">載入失敗，請稍後重試</div>`; }
  finally{ $("refreshBtn").classList.remove("spinning"); }
}

function startAutoRefresh(){
  stopAutoRefresh();
  state.timer = setInterval(refreshBoard, 30000);
}
function stopAutoRefresh(){ if(state.timer){ clearInterval(state.timer); state.timer=null; } }

// ---------- SETTINGS (route/stop switcher) ----------
function openSettings(){
  $("overlay").hidden=false;
  $("settingsPanel").classList.add("open");
  $("settingsPanel").setAttribute("aria-hidden","false");
  populateRouteList();
  $("routeInput").value = state.route;
  loadDirStops(state.route, state.dir);
}
function closeSettings(){
  $("overlay").hidden=true;
  $("settingsPanel").classList.remove("open");
  $("settingsPanel").setAttribute("aria-hidden","true");
}
function populateRouteList(){
  if(!$("routeList").children.length && state.routesDest){
    const dl = $("routeList");
    Object.keys(state.routesDest).forEach(r=>{
      const o=document.createElement("option"); o.value=r; dl.appendChild(o);
    });
  }
}
async function loadDirStops(route, dir){
  const sel = $("stopSelect");
  sel.innerHTML = `<option>載入中…</option>`;
  // cache route-stops per route
  if(!state.routeStops) state.routeStops = {};
  const key = route;
  if(!state.routeStops[key]){
    try{
      const [ob, ib] = await Promise.all([
        getJSON(`${API}/route-stop/ctb/${route}/outbound`),
        getJSON(`${API}/route-stop/ctb/${route}/inbound`),
      ]);
      state.routeStops[key] = {outbound:ob||[], inbound:ib||[]};
    }catch(e){ state.routeStops[key]={outbound:[],inbound:[]}; }
  }
  const stops = state.routeStops[key][dir]||[];
  // fetch stop names
  const items = await Promise.all(stops.map(async s=>{
    let name = s.stop;
    if(state.stopsDb && state.stopsDb[s.stop]) name = state.stopsDb[s.stop].name_tc;
    else { try{ const d=await getJSON(`${API}/stop/${s.stop}`); if(d) name=d.name_tc; }catch(e){} }
    return {stop:s.stop, seq:s.seq, name};
  }));
  sel.innerHTML = items.length
    ? items.map(i=>`<option value="${i.stop}">${i.seq}. ${i.name}</option>`).join("")
    : `<option>沒有站點</option>`;
  // preselect current
  if(state.stop && [...sel.options].some(o=>o.value===state.stop)) sel.value = state.stop;
  state._settingsStops = items;
}
async function applySettings(){
  const route = $("routeInput").value.trim().toUpperCase();
  const dir = document.querySelector(".dir-btn.active").dataset.dir;
  const stop = $("stopSelect").value;
  if(!route){ alert("請輸入路線號碼"); return; }
  if(!stop || isNaN(Number(stop))){ alert("請選擇車站"); return; }
  state.route=route; state.dir=dir; state.stop=stop;
  savePref();
  closeSettings();
  await refreshBoard();
}

// ---------- NEARBY (GPS) MODE ----------
async function ensureStopsDb(){
  if(state.stopsDb) return state.stopsDb;
  const [stops, dest] = await Promise.all([
    fetch("stops_db.json").then(r=>r.json()),
    fetch("routes_dest.json").then(r=>r.json()),
  ]);
  state.stopsDb = stops;
  state.routesDest = dest;
  return stops;
}

function locateAndShow(){
  $("nearbyHint").textContent = "正在定位…";
  $("nearbyHint").classList.add("hint");
  $("stopList").innerHTML = `<div style="text-align:center;padding:30px"><span class="loader"></span><div style="color:var(--muted);margin-top:10px;font-size:14px">搜尋附近城巴站…</div></div>`;
  if(!navigator.geolocation){ $("nearbyHint").textContent="此裝置不支援定位功能。"; $("stopList").innerHTML=""; return; }
  navigator.geolocation.getCurrentPosition(onLocate, onLocateError, {enableHighAccuracy:true, timeout:15000, maximumAge:0});
}
async function onLocate(pos){
  const {latitude, longitude} = pos.coords;
  $("nearbyHint").textContent = `你的位置：${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  try{
    await ensureStopsDb();
    const arr = Object.values(state.stopsDb).filter(s=>s.lat&&s.long).map(s=>({
      ...s, dist:haversine(latitude,longitude,s.lat,s.long)
    })).sort((a,b)=>a.dist-b.dist).slice(0,12);
    state.nearbyStops = arr;
    renderNearbyList(arr);
  }catch(e){
    $("stopList").innerHTML = `<div class="eta-card empty">載入車站資料失敗</div>`;
  }
}
function onLocateError(err){
  $("nearbyHint").textContent = "無法取得定位："+ (err.message||"請允許瀏覽器使用定位");
  $("stopList").innerHTML = "";
}
function renderNearbyList(arr){
  const list = $("stopList");
  list.innerHTML = "";
  if(!arr.length){ list.innerHTML = `<div class="eta-card empty">附近沒有找到城巴站</div>`; return; }
  const pin = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
  arr.forEach(s=>{
    const item = document.createElement("div");
    item.className="stop-item";
    item.innerHTML = `
      <span class="pin">${pin}</span>
      <span class="info"><span class="nm">${s.name_tc||s.id}</span><span class="en">${s.name_en||""}</span></span>
      <span class="dist">${fmtDist(s.dist)}</span>`;
    item.onclick = ()=> openStopDetail(s);
    list.appendChild(item);
  });
}

// ---------- STOP DETAIL (nearby selected) ----------
async function openStopDetail(stop){
  state.selectedStop = stop;
  switchView("stop-detail");
  $("detailStopName").textContent = stop.name_tc || stop.id;
  $("detailStopSub").textContent = stop.name_en || "";
  $("detailEtaCards").innerHTML = `<div style="text-align:center;padding:30px"><span class="loader"></span></div>`;
  await loadStopDetail();
  startDetailRefresh();
}
function startDetailRefresh(){ stopDetailRefresh(); state.detailTimer = setInterval(loadStopDetail, 30000); }
function stopDetailRefresh(){ if(state.detailTimer){ clearInterval(state.detailTimer); state.detailTimer=null; } }
async function loadStopDetail(){
  const stop = state.selectedStop; if(!stop) return;
  let groups = [];
  try{
    const data = await getJSON(`${BATCH}/${CO}/${stop.id}`) || [];
    // group by route+dir
    const map = {};
    data.forEach(e=>{
      const k = e.route+"|"+e.dir;
      (map[k] = map[k]||[]).push(e);
    });
    groups = Object.entries(map).map(([k,arr])=>{
      const [route,dir] = k.split("|");
      let dest = "";
      if(state.routesDest && state.routesDest[route]) dest = state.routesDest[route][dir] || "";
      arr.sort((a,b)=>a.eta_seq-b.eta_seq);
      return {route, dir, dest, etas:arr.slice(0,3)};
    }).sort((a,b)=>a.route.localeCompare(b.route,"en",{numeric:true}));
  }catch(e){ groups=[]; }
  renderStopDetail(groups);
}
function renderStopDetail(groups){
  const wrap = $("detailEtaCards"); wrap.innerHTML="";
  if(!groups.length){ wrap.innerHTML=`<div class="eta-card empty">暫時沒有班次資料</div>`; }
  groups.forEach(g=>{
    const card = document.createElement("div");
    card.className="eta-card next";
    const etasHtml = g.etas.map(e=>{
      const mins = relMinutes(e.eta);
      let t = isNaN(mins)? "--" : mins<=0? "即將到達" : mins<60? `${mins} 分鐘` : `${Math.floor(mins/60)} 小時 ${mins%60} 分`;
      return `<div style="display:flex;gap:10px;align-items:baseline;padding:3px 0"><span style="font-family:'JetBrains Mono',monospace;font-weight:800;color:var(--amber-soft);min-width:48px">${fmtHM(new Date(e.eta))}</span><span style="color:var(--text);font-weight:600">${t}</span></div>`;
    }).join("");
    card.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <span class="route-badge" style="min-width:auto;padding:5px 11px;font-size:19px">${g.route}</span>
        <span style="font-weight:700;font-size:14px;flex:1;min-width:0">${g.dest||""}</span>
      </div>
      <div style="font-size:13px">${etasHtml||"<span style='color:var(--muted)'>未有班次</span>"}</div>`;
    wrap.appendChild(card);
  });
  $("detailUpdated").textContent = `更新時間：${fmtClock()}`;
}

// ---------- VIEW SWITCHING ----------
function switchView(name){
  state.mode = name;
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));
  if(name==="board"){ $("boardView").classList.add("active"); }
  else if(name==="nearby"){ $("nearbyView").classList.add("active"); }
  else if(name==="stop-detail"){ $("stopDetailView").classList.add("active"); }
  document.querySelectorAll(".mode-btn").forEach(b=>b.classList.toggle("active", (name==="board"||name==="stop-detail")? b.dataset.mode==="board" : b.dataset.mode==="nearby"));
}
function setMode(mode){
  if(mode==="nearby"){ switchView("nearby"); stopAutoRefresh(); stopDetailRefresh(); }
  else { switchView("board"); stopDetailRefresh(); startAutoRefresh(); refreshBoard(); }
}

// ---------- persistence ----------
function savePref(){ /* in-memory only; localStorage blocked in preview */ }

// ---------- events ----------
document.querySelectorAll(".mode-btn").forEach(b=> b.addEventListener("click", ()=> setMode(b.dataset.mode)));
$("refreshBtn").addEventListener("click", refreshBoard);
$("settingsBtn").addEventListener("click", openSettings);
$("closeSettings").addEventListener("click", closeSettings);
$("overlay").addEventListener("click", closeSettings);
$("applySettings").addEventListener("click", applySettings);
$("locateBtn").addEventListener("click", locateAndShow);
$("backBtn").addEventListener("click", ()=> setMode("nearby"));
document.querySelectorAll(".dir-btn").forEach(b=> b.addEventListener("click", ()=>{
  document.querySelectorAll(".dir-btn").forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  const route = $("routeInput").value.trim().toUpperCase() || state.route;
  loadDirStops(route, b.dataset.dir);
}));
$("routeInput").addEventListener("change", ()=>{
  const route = $("routeInput").value.trim().toUpperCase();
  if(route){ const dir=document.querySelector(".dir-btn.active").dataset.dir; loadDirStops(route, dir); }
});

// ---------- init ----------
(async function init(){
  // Load the local stops DB first so stop names render without extra requests.
  try{ await ensureStopsDb(); }catch(e){}
  $("clock").textContent = fmtClock();
  await refreshBoard();
  startAutoRefresh();
})();
