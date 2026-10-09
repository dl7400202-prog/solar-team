/* Coordinates stay in the signed-in shared workspace. Device fixes stay in memory. */
const point = p => Array.isArray(p) && p.length===2 && p.every(v=>Number.isFinite(v)&&Math.abs(v)<=2e7);
const supported = crs => ['EPSG:25832','EPSG:32632'].includes(crs);
const FRESH_MS=30000;
export function mapBounds(rows,padding=20) {
  const points=rows.flatMap(r=>[r.north,r.south]).filter(point);
  if(!points.length)return null;
  return {minE:Math.min(...points.map(p=>p[0]))-padding,maxE:Math.max(...points.map(p=>p[0]))+padding,minN:Math.min(...points.map(p=>p[1]))-padding,maxN:Math.max(...points.map(p=>p[1]))+padding};
}
export function nearestRow(p,rows) {
  if(!point(p))return null;
  let nearest=null;
  for(const row of rows){if(!point(row.north)||!point(row.south))continue;const [x,y]=row.north,dx=row.south[0]-x,dy=row.south[1]-y,length=dx*dx+dy*dy;const t=length?Math.max(0,Math.min(1,((p[0]-x)*dx+(p[1]-y)*dy)/length)):0;const distance=Math.hypot(p[0]-x-t*dx,p[1]-y-t*dy);if(!nearest||distance<nearest.distance)nearest={row,distance};}
  return nearest;
}
export function projectLocation(fix,crs,proj) {
  if(!supported(crs)||typeof proj!=='function'||!Number.isFinite(fix?.latitude)||!Number.isFinite(fix?.longitude))return null;
  if(Math.abs(fix.latitude)>90||Math.abs(fix.longitude)>180)return null;
  try{const definition=crs==='EPSG:25832'?'+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs':'+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs';const result=proj('EPSG:4326',definition,[fix.longitude,fix.latitude]);return point(result)?result:null;}catch{return null;}
}
export function createLocationTracker({geolocation,secure,aligned,now=()=>Date.now(),onChange=()=>{}}) {
  let watch=null,epoch=0,wanted=false,status='idle',fix=null;
  const state=()=>({status:fix&&now()-fix.timestamp>FRESH_MS?'stale':status,active:watch!==null,enabled:wanted,fix:fix&&now()-fix.timestamp<=FRESH_MS?{...fix}:null});
  const notify=()=>onChange(state());
  function clear(){epoch++;if(watch!==null){geolocation?.clearWatch(watch);watch=null;}fix=null;}
  function stop(next='idle',keep=false){clear();if(!keep)wanted=false;status=next;notify();}
  function start(){
    if(watch!==null)return;
    if(!aligned())return stop('alignment');
    if(!secure)return stop('insecure');
    if(typeof geolocation?.watchPosition!=='function')return stop('unsupported');
    wanted=true;status='locating';fix=null;const token=++epoch;notify();
    try{watch=geolocation.watchPosition(position=>{
      if(token!==epoch||!wanted)return;
      const c=position?.coords,t=position?.timestamp;
      if(!c||![c.latitude,c.longitude,c.accuracy,t].every(Number.isFinite)||Math.abs(c.latitude)>90||Math.abs(c.longitude)>180||c.accuracy<0){fix=null;status='unavailable';notify();return;}
      if(now()-t>FRESH_MS||t>now()+5000||(fix&&t<fix.timestamp))return;
      fix={latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,timestamp:t};status='watching';notify();
    },error=>{if(token!==epoch)return;if(error?.code===1){stop('denied');return;}fix=null;status=error?.code===3?'timeout':'unavailable';notify();},{enableHighAccuracy:true,maximumAge:0,timeout:15000});notify();}catch{stop('unavailable');}
  }
  return {state,start,stop:()=>stop(),pause:()=>{if(wanted)stop('paused',true)},resume:()=>{if(wanted&&watch===null)start()},dispose:()=>stop()};
}
const messages={idle:'Location is off. Select My position to enable it.',alignment:'GPS alignment needs the coordinate system from the original project. Rows are shown in source coordinates.',locating:'Finding your position…',watching:'Live position',paused:'Location paused while this map is hidden.',stale:'Location is out of date. Waiting for a fresh position.',denied:'Location permission was denied. Allow location access in browser or phone settings, then try again.',timeout:'No fresh position arrived. Move to an open area and try again.',unavailable:'Your position is unavailable. Check location settings and try again.',unsupported:'This device does not support browser location.',insecure:'Location requires an HTTPS connection.'};
export function createSiteMap(api) {
  const esc=api.esc,db=()=>api.getDb(),source=()=>db().siteMap;
  let root=null,svg=null,abort=null,resize=null,timer=null,view=null,origin=null,filter='',query='',selected=null,pendingRow=null,pendingSearch=false,follow=false,visible=false;
  const geometry=()=>Array.isArray(source()?.rows)?source().rows.filter(r=>Number.isSafeInteger(r.rowNumber)&&r.rowNumber>=0&&typeof r.field==='string'&&point(r.north)&&point(r.south)):[];
  let planDocument=null,planIndex=new Map();
  const planFor=row=>{const current=db();if(current!==planDocument){planDocument=current;planIndex=new Map((current.rowPlans||[]).map(p=>[p.field+'\0'+p.rowNumber,p]));}return planIndex.get(row.field+'\0'+row.rowNumber);};
  const matches=(row,term)=>!term||[row.rowNumber,row.pilePlanRow,...(row.groups||[]).map(g=>g.id)].some(v=>String(v??'').toLowerCase().includes(term.toLowerCase()))||[row.motor?.id,...(row.posts||[]).map(p=>p.id)].some(v=>/^\d+$/.test(term)?String(v)===term:String(v??'').toLowerCase().includes(term.toLowerCase()))||String(planFor(row)?.rowType||'').toLowerCase().includes(term.toLowerCase());
  const filtered=()=>geometry().filter(r=>!filter||r.field===filter);
  const searchResults=()=>filtered().filter(r=>matches(r,query));
  const projection=()=>api.projector||globalThis.proj4;
  const aligned=()=>supported(source()?.crs)&&typeof projection()==='function';
  const tracker=createLocationTracker({geolocation:api.geolocation||globalThis.navigator?.geolocation,secure:api.secure??globalThis.isSecureContext,aligned,onChange:state=>{
    if(!visible)return;
    if(follow&&state.fix){const p=projectLocation(state.fix,source()?.crs,projection());if(p){center(p,true);paint();return;}}
    if(!state.enabled)follow=false;
    paintLocation();
  }});
  const button=(label,action,extra='')=>'<button type="button" data-map-action="'+action+'" '+extra+'>'+label+'</button>';
  function html(field='',term=''){
    if(filter!==field||query!==term){view=null;selected=null;pendingSearch=true;follow=false;}
    filter=field;query=term;
    const rows=filtered();
    return '<section class="site-map card" aria-label="Site map"><div class="site-map-heading"><div><h2>Site map</h2><small>'+rows.length+' mapped rows · North at the top</small></div>'+button('All rows','fit','class="compact"')+'</div>'+(!source()?.crs?'<p class="plan-notice">GPS alignment awaits the coordinate system from the original project.</p>':'')+'<div class="site-map-surface"><svg class="site-map-svg" tabindex="0" role="group" aria-label="Row map. Drag to pan, pinch or use plus and minus to zoom." xmlns="http://www.w3.org/2000/svg"></svg><span class="site-map-north" aria-hidden="true">↑<br>N</span><div class="site-map-zoom" aria-label="Map zoom">'+button('+','zoom-in','aria-label="Zoom in"')+button('−','zoom-out','aria-label="Zoom out"')+'</div><div class="site-map-scale" aria-hidden="true"></div></div><div class="site-map-location-controls">'+button('◎ My position','locate','class="secondary"')+button('Follow me','follow','class="secondary" aria-pressed="false"')+button('Stop location','stop','class="text-button" hidden')+'</div><p class="site-map-status hint" role="status"></p><p class="site-map-nearest hint"></p><div class="site-map-selection" aria-live="polite"></div><p class="hint">Drag to move · Pinch to zoom · Tap a row to open its details. Distances use the source coordinates. Device location is not saved.</p>'+((query&&!searchResults().length)||!rows.length?'<p class="plan-notice">No mapped rows match this search. Clear the filters to find a row.</p>':'')+'</section>';
  }
  function fit(rows=filtered()){
    const bounds=mapBounds(rows);if(!bounds)return;
    const all=mapBounds(geometry(),0);origin={e:all.minE,n:all.maxN};
    const ratio=Math.max(1,svg?.clientWidth||350)/Math.max(1,svg?.clientHeight||420),w=bounds.maxE-bounds.minE,h=bounds.maxN-bounds.minN,width=Math.max(w,h*ratio),height=width/ratio;
    view={x:(bounds.minE+bounds.maxE)/2-origin.e-width/2,y:origin.n-(bounds.minN+bounds.maxN)/2-height/2,width,height};
  }
  const xy=p=>[p[0]-origin.e,origin.n-p[1]];
  function center(p,close=false){if(!view||!origin)return;if(close&&view.width>140){view.height*=140/view.width;view.width=140;}const [x,y]=xy(p);view.x=x-view.width/2;view.y=y-view.height/2;}
  function zoom(factor,anchor){if(!view)return;const width=Math.max(18,Math.min(12000,view.width*factor)),height=width*view.height/view.width,c=anchor||[view.x+view.width/2,view.y+view.height/2],fractionX=(c[0]-view.x)/view.width,fractionY=(c[1]-view.y)/view.height;view={x:c[0]-fractionX*width,y:c[1]-fractionY*height,width,height};follow=false;paint();}
  function mapPoint(clientX,clientY){const bounds=svg.getBoundingClientRect();return [view.x+(clientX-bounds.left)/bounds.width*view.width,view.y+(clientY-bounds.top)/bounds.height*view.height];}
  function paint(){
    if(!root||!svg||!view||!origin)return;
    svg.setAttribute('viewBox',[view.x,view.y,view.width,view.height].join(' '));svg.setAttribute('preserveAspectRatio','none');
    const rows=filtered(),selection=geometry().find(r=>r.rowNumber===selected&&(!filter||r.field===filter));
    const units=view.width/(svg.clientWidth||350),labels=[];
    let drawing='<defs><pattern id="site-map-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#d3e4d9" stroke-width=".7" vector-effect="non-scaling-stroke"/></pattern></defs><rect x="'+view.x+'" y="'+view.y+'" width="'+view.width+'" height="'+view.height+'" fill="url(#site-map-grid)"/>';
    for(const row of rows){const n=xy(row.north),s=xy(row.south),chosen=row.rowNumber===selected,p=planFor(row);const inView=n[0]>=view.x-10&&n[0]<=view.x+view.width+10&&s[1]>=view.y-10&&n[1]<=view.y+view.height+10;if(!inView)continue;
      drawing+='<g class="site-map-row" data-row-number="'+row.rowNumber+'"><title>Row '+row.rowNumber+' · '+esc(row.field)+'</title><path d="M'+n.join(' ')+'L'+s.join(' ')+'" stroke="'+(chosen?'#00875b':'#183b5c')+'" stroke-width="'+(chosen?5:2)+'" vector-effect="non-scaling-stroke"/>';
      if(view.width<180)for(let i=0;i<(row.groups||[]).length;i++){const group=row.groups[i],gn=xy(group.north),gs=xy(group.south),type=(db().panelTypes||[]).find(t=>t.id===p?.panelGroups?.[i]?.typeId),colour=/^#[a-f0-9]{6}$/i.test(type?.color||'')?type.color:'#c5ced7';drawing+='<path d="M'+gn.join(' ')+'L'+gs.join(' ')+'" stroke="'+colour+'" stroke-width="2" vector-effect="non-scaling-stroke"/>'}
      if(view.width<300||chosen){labels.push({rowNumber:row.rowNumber,n,chosen});if(row.drive&&point(row.drive.point)){const d=xy(row.drive.point);drawing+='<circle class="site-map-drive" cx="'+d[0]+'" cy="'+d[1]+'" r="'+units*4.2+'" fill="#ae3042"><title>Drive gap after panel '+row.drive.after+'</title></circle>'}}
      drawing+='</g>';
    }
    const surface=svg.getBoundingClientRect(),overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,occupied=[...root.querySelectorAll('.site-map-north,.site-map-zoom,.site-map-scale')].map(node=>{const r=node.getBoundingClientRect();return {left:r.left-surface.left-4,right:r.right-surface.left+4,top:r.top-surface.top-4,bottom:r.bottom-surface.top+4};});
    labels.sort((a,b)=>Number(b.chosen)-Number(a.chosen));
    for(const label of labels){const font=label.chosen?13:12,width=font*(String(label.rowNumber).length*.75+.6),half=width/2;let x=(label.n[0]-view.x)/units,y=(label.n[1]-view.y)/units-font;
      if(label.chosen){x=Math.max(half+4,Math.min(surface.width-half-4,x));y=Math.max(font*1.2+4,Math.min(surface.height-font*.3-4,y));}
      let box={left:x-half,right:x+half,top:y-font*1.2,bottom:y+font*.3};
      if(label.chosen)for(const obstacle of occupied)if(overlaps(box,obstacle)){y=obstacle.bottom+font*1.2+4;box={...box,top:y-font*1.2,bottom:y+font*.3};}
      if(box.left<4||box.right>surface.width-4||box.top<4||box.bottom>surface.height-4||occupied.some(other=>overlaps(box,other)))continue;
      occupied.push(box);drawing+='<text data-row-label="'+label.rowNumber+'" x="'+(view.x+x*units)+'" y="'+(view.y+y*units)+'" text-anchor="middle" font-size="'+font*units+'" font-weight="'+(label.chosen?700:400)+'" fill="'+(label.chosen?'#006b49':'#152840')+'">'+label.rowNumber+'</text>';
    }
    drawing+='<g class="site-map-user"></g>';svg.innerHTML=drawing;
    const scale=root.querySelector('.site-map-scale'),target=view.width/4,power=10**Math.floor(Math.log10(target)),unit=target/power>=5?5:target/power>=2?2:1,metres=unit*power;scale.style.width=Math.max(1,metres/view.width*(svg.clientWidth||350))+'px';scale.textContent=metres>=1000?metres/1000+' km':metres+' m';
    paintSelection(selection);paintLocation();
  }
  function paintSelection(row){const host=root.querySelector('.site-map-selection');if(!row){host.innerHTML='';return;}const plan=planFor(row),count=plan?.panelCount??row.panelCount;host.innerHTML='<div class="site-map-row-card"><strong>Row '+row.rowNumber+' · '+esc(row.field)+'</strong><small>Pile plan row '+esc(row.pilePlanRow)+' · '+esc(count)+' panels</small><small>Motor post '+esc(row.motor?.post)+' · ID '+esc(row.motor?.id)+'</small>'+(plan&&plan.panelCount!==row.panelCount?'<p class="plan-notice">This plan has changed since the coordinate import. Map geometry still uses the source layout.</p>':'')+'<div class="site-map-row-actions">'+button('Open row','open','class="secondary"')+button('Pallet placement','pallets','class="secondary"')+'</div></div>';}
  function paintLocation(){
    if(!visible||!root||!svg)return;
    const state=tracker.state(),p=state.fix&&projectLocation(state.fix,source()?.crs,projection()),status=root.querySelector('.site-map-status'),nearest=root.querySelector('.site-map-nearest'),user=svg.querySelector('.site-map-user');
    status.textContent=messages[state.status]||messages.idle;
    if(state.fix)status.textContent+=' · Accuracy ±'+Math.ceil(state.fix.accuracy)+' m · Updated '+new Date(state.fix.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    if(user)user.innerHTML='';nearest.textContent='';
    if(p&&view&&origin){const [x,y]=xy(p),radius=state.fix.accuracy,units=view.width/(svg.clientWidth||350);user.innerHTML='<circle class="site-map-accuracy" cx="'+x+'" cy="'+y+'" r="'+radius+'" fill="#2187ff22" stroke="#2187ff" stroke-width="1" vector-effect="non-scaling-stroke"/><circle class="site-map-dot" cx="'+x+'" cy="'+y+'" r="'+units*6+'" fill="#1674e9" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"><title>You are here. Accuracy ±'+Math.ceil(radius)+' metres.</title></circle>';
      const match=nearestRow(p,geometry());if(match)nearest.textContent=match.distance>100?'Your reported position is outside the row area.':'Nearest row centreline: '+match.row.rowNumber+' · '+Math.round(match.distance)+' m. Accuracy ±'+Math.ceil(radius)+' m; confirm the row number on site.';
    }
    root.querySelector('[data-map-action="follow"]').setAttribute('aria-pressed',String(follow&&state.enabled));root.querySelector('[data-map-action="stop"]').hidden=!state.enabled;
    if(svg&&view)svg.setAttribute('viewBox',[view.x,view.y,view.width,view.height].join(' '));
  }
  function select(row,focus=true){if(!row)return;selected=row.rowNumber;follow=false;if(focus)fit([row]);paint();}
  function mount(host){
    abort?.abort();resize?.disconnect();if(timer)clearInterval(timer);root=host;svg=root?.querySelector('svg.site-map-svg');if(!root||!svg)return;
    visible=true;abort=new AbortController();const signal=abort.signal;
    if(!view)fit();if(pendingRow){select(pendingRow);pendingRow=null;}else if(pendingSearch&&query&&searchResults().length===1)select(searchResults()[0]);else paint();pendingSearch=false;
    if(typeof ResizeObserver==='function'){resize=new ResizeObserver(()=>{if(!visible||!view||!svg.clientWidth||!svg.clientHeight)return;const height=view.width*svg.clientHeight/svg.clientWidth;view.y+=(view.height-height)/2;view.height=height;paint();});resize.observe(svg);}
    root.addEventListener('click',event=>{const action=event.target.closest('[data-map-action]')?.dataset.mapAction;if(!action)return;
      if(action==='fit'){follow=false;selected=null;fit();paint();}
      else if(action==='zoom-in'||action==='zoom-out')zoom(action==='zoom-in'?.6:1/.6);
      else if(action==='locate'){follow=true;const state=tracker.state();if(state.fix){const p=projectLocation(state.fix,source()?.crs,projection());if(p){center(p,true);paint();}}else tracker.start();}
      else if(action==='follow'){follow=!(follow&&tracker.state().enabled);if(follow){tracker.start();const fix=tracker.state().fix,p=fix&&projectLocation(fix,source()?.crs,projection());if(p)center(p,true);}paint();}
      else if(action==='stop'){follow=false;tracker.stop();}
      else if(['open','pallets'].includes(action)){const row=geometry().find(r=>r.rowNumber===selected),plan=row&&planFor(row);if(plan)api.openRow(plan.id,action==='pallets');}
    },{signal});
    const pointers=new Map();let previous=null,moved=false;
    svg.addEventListener('pointerdown',event=>{if(!view)return;svg.setPointerCapture(event.pointerId);pointers.set(event.pointerId,[event.clientX,event.clientY]);previous={points:[...pointers.values()],view:{...view}};moved=false;},{signal});
    svg.addEventListener('pointermove',event=>{if(!pointers.has(event.pointerId)||!previous)return;pointers.set(event.pointerId,[event.clientX,event.clientY]);const points=[...pointers.values()],start=previous.points;
      if(points.length===1&&start.length===1){const dx=points[0][0]-start[0][0],dy=points[0][1]-start[0][1];if(Math.abs(dx)+Math.abs(dy)>5)moved=true;if(!moved)return;view={...previous.view,x:previous.view.x-dx/svg.clientWidth*previous.view.width,y:previous.view.y-dy/svg.clientHeight*previous.view.height};}
      else if(points.length===2&&start.length===2){const before=Math.hypot(start[0][0]-start[1][0],start[0][1]-start[1][1]),after=Math.hypot(points[0][0]-points[1][0],points[0][1]-points[1][1]);if(before<5||after<5)return;view={...previous.view};const anchor=mapPoint((start[0][0]+start[1][0])/2,(start[0][1]+start[1][1])/2);zoom(before/after,anchor);moved=true;}
      follow=false;paint();
    },{signal});
    const end=event=>{if(!pointers.has(event.pointerId))return;const tap=!moved&&pointers.size===1&&event.type==='pointerup';pointers.delete(event.pointerId);previous=pointers.size?{points:[...pointers.values()],view:{...view}}:null;if(tap&&origin){const p=mapPoint(event.clientX,event.clientY),match=nearestRow([p[0]+origin.e,origin.n-p[1]],filtered());if(match&&match.distance<=view.width/svg.clientWidth*14)select(match.row);}};
    svg.addEventListener('pointerup',end,{signal});svg.addEventListener('pointercancel',end,{signal});
    svg.addEventListener('wheel',event=>{if(!view||document.activeElement!==svg)return;event.preventDefault();zoom(event.deltaY>0?1.2:1/1.2,mapPoint(event.clientX,event.clientY));},{signal,passive:false});
    svg.addEventListener('keydown',event=>{const dx=view?.width*.15,dy=view?.height*.15;if(!view)return;if(event.key==='+'||event.key==='=')zoom(.7);else if(event.key==='-')zoom(1/.7);else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){view.x+=event.key==='ArrowLeft'?-dx:event.key==='ArrowRight'?dx:0;view.y+=event.key==='ArrowUp'?-dy:event.key==='ArrowDown'?dy:0;follow=false;paint();}else return;event.preventDefault();},{signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)tracker.pause();else if(visible)tracker.resume();},{signal});
    window.addEventListener('pagehide',()=>{follow=false;tracker.stop();},{signal});
    timer=setInterval(paintLocation,1000);
  }
  function hide(){visible=false;abort?.abort();abort=null;resize?.disconnect();resize=null;if(timer)clearInterval(timer);timer=null;tracker.dispose();follow=false;root=null;svg=null;}
  return {html,mount,hide,hasGeometry:()=>geometry().length>0,matches,selectRow:row=>{pendingRow=row;view=null;},tracker};
}
