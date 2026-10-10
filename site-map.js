/* Coordinates stay in the signed-in shared workspace. Device fixes stay in memory. */
const point = p => Array.isArray(p) && p.length===2 && p.every(v=>Number.isFinite(v)&&Math.abs(v)<=2e7);
const supported = crs => ['EPSG:25832','EPSG:32632'].includes(crs);
const definition = crs => crs==='EPSG:25832'?'+proj=utm +zone=32 +ellps=GRS80 +units=m +no_defs':'+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs';
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
  try{const result=proj('EPSG:4326',definition(crs),[fix.longitude,fix.latitude]);return point(result)?result:null;}catch{return null;}
}
export function sourcePointToLocation(p,crs,proj) {
  if(!point(p)||!supported(crs)||typeof proj!=='function')return null;
  try{const result=proj(definition(crs),'EPSG:4326',p);return point(result)&&Math.abs(result[0])<=180&&Math.abs(result[1])<=90?{lat:result[1],lng:result[0]}:null;}catch{return null;}
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
  let root=null,svg=null,abort=null,resize=null,timer=null,view=null,origin=null,filter='',query='',selected=null,pendingRow=null,pendingSearch=false,follow=false,visible=false,mode='plan',satelliteState='idle';
  const geometry=()=>Array.isArray(source()?.rows)?source().rows.filter(r=>Number.isSafeInteger(r.rowNumber)&&r.rowNumber>=0&&typeof r.field==='string'&&point(r.north)&&point(r.south)):[];
  let planDocument=null,planIndex=new Map();
  const planFor=row=>{const current=db();if(current!==planDocument){planDocument=current;planIndex=new Map((current.rowPlans||[]).map(p=>[p.field+'\0'+p.rowNumber,p]));}return planIndex.get(row.field+'\0'+row.rowNumber);};
  const matches=(row,term)=>!term||[row.rowNumber,row.pilePlanRow,...(row.groups||[]).map(g=>g.id)].some(v=>String(v??'').toLowerCase().includes(term.toLowerCase()))||[row.motor?.id,...(row.posts||[]).map(p=>p.id)].some(v=>/^\d+$/.test(term)?String(v)===term:String(v??'').toLowerCase().includes(term.toLowerCase()))||String(planFor(row)?.rowType||'').toLowerCase().includes(term.toLowerCase());
  const filtered=()=>geometry().filter(r=>!filter||r.field===filter);
  const searchResults=()=>filtered().filter(r=>matches(r,query)).sort((a,b)=>(String(a.rowNumber)===query?0:1)-(String(b.rowNumber)===query?0:1));
  const projection=()=>api.projector||globalThis.proj4;
  const aligned=()=>supported(source()?.crs)&&typeof projection()==='function';
  const tracker=createLocationTracker({geolocation:api.geolocation||globalThis.navigator?.geolocation,secure:api.secure??globalThis.isSecureContext,aligned:()=>mode==='satellite'?['ready','alignment'].includes(satelliteState):aligned(),onChange:state=>{
    if(!visible)return;
    if(mode==='satellite'){if(!state.enabled)follow=false;paintLocation();return;}
    if(follow&&state.fix){const p=projectLocation(state.fix,source()?.crs,projection());if(p){center(p,true);paint();return;}}
    if(!state.enabled)follow=false;
    paintLocation();
  }});
  const satellite=api.createSatellite?.({toLocation:p=>sourcePointToLocation(p,source()?.crs,projection()),colourFor:(row,index)=>{const typeId=planFor(row)?.panelGroups?.[index]?.typeId;return (db().panelTypes||[]).find(t=>t.id===typeId)?.color;},onSelect:row=>select(row),onGesture:()=>{follow=false;paintLocation();},onStatus:state=>{
    satelliteState=state;if(!root||!visible)return;
    const message=root.querySelector('.site-map-google-message'),canvas=root.querySelector('.site-map-google-canvas');
    if(message){message.hidden=!['loading','error'].includes(state);message.textContent=state==='loading'?'Loading Google Maps…':'Google Maps is temporarily unavailable. Use Row plan or reload this page after Google access is activated.';}
    if(canvas)canvas.hidden=state==='error';
    if(mode==='satellite'&&state==='error'){follow=false;tracker.stop();}
    paintLocation();
  }});
  let selectionKey=null,fieldRole='worker',imagery=null,imageryEpoch=0;
  const button=(label,action,extra='')=>'<button type="button" data-map-action="'+action+'" '+extra+'>'+label+'</button>';
  function imageryNote(text='',credit=false){const note=root?.querySelector('.site-map-imagery-note');if(note){note.innerHTML=credit?'<a href="https://www.geodanmark.dk/home/vejledninger/vilkaar-for-data-anvendelse/" target="_blank" rel="noopener noreferrer">@GeoDanmark</a> · '+esc(text)+' · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>':esc(text);note.hidden=!text;}}
  async function loadAerial(){const host=root,token=++imageryEpoch;imageryNote('Loading aerial photo…');try{const result=await api.getImagery();if(token!==imageryEpoch||root!==host||!visible||mode!=='aerial')return;imagery=result;imageryNote('Photo '+result.meta.year,true);paint();}catch(error){if(token!==imageryEpoch||root!==host||!visible)return;imagery=null;setMode('plan');imageryNote(error.message||'Aerial photo is unavailable. Use Row plan.');}}
  function viewButtons(){return '<div class="site-map-view-switch" role="group" aria-label="Map view">'+button('Row plan','view-plan','aria-pressed="'+(mode==='plan')+'"')+(api.hasImagery?.()?button('Aerial','view-aerial','aria-pressed="'+(mode==='aerial')+'"'):'')+(satellite?button('Satellite','view-satellite','aria-pressed="'+(mode==='satellite')+'" '+(api.isOffline?.()?'disabled title="Google satellite needs a connection"':'')):'')+'</div>';}
  function html(field='',term='',options={}){
    if(api.isOffline?.()&&mode==='satellite'){satellite?.destroy();tracker.stop();mode='plan';}
    if(filter!==field||query!==term){view=null;selected=null;pendingSearch=true;follow=false;}
    filter=field;query=term;
    const rows=filtered();
    const fieldTools=options.fullscreen?'<div class="field-map-roles" aria-label="Field view">'+button('Worker','role-worker','aria-pressed="'+(fieldRole==='worker')+'"')+button('Driver','role-driver','aria-pressed="'+(fieldRole==='driver')+'"')+'</div>':'<button type="button" class="secondary field-map-open" data-action="plan-field-open">⛶ Field mode</button>';
    return '<section class="site-map card'+(options.fullscreen?' site-map-field':'')+'" aria-label="Site map">'+fieldTools+'<div class="site-map-heading"><div><h2>Site map</h2><small>'+rows.length+' mapped rows · North at the top</small></div>'+button('All rows','fit','class="compact"')+'</div>'+viewButtons()+(!aligned()?'<p class="plan-notice site-map-alignment">GPS alignment awaits the coordinate system from the original project.</p>':'')+'<p class="site-map-imagery-note" role="status" hidden></p><div class="site-map-location-controls">'+button('◎ My position','locate','class="secondary"')+button('Follow me','follow','class="secondary" aria-pressed="false"')+button('Stop location','stop','class="text-button" hidden')+'</div><p class="site-map-status hint" role="status"></p><div class="site-map-stage" data-view="'+mode+'"><div class="site-map-plan" '+(mode!=='satellite'?'':'hidden')+'><div class="site-map-surface"><svg class="site-map-svg" tabindex="0" role="group" aria-label="Row map. Drag to pan, pinch or use plus and minus to zoom." xmlns="http://www.w3.org/2000/svg"></svg><span class="site-map-north" aria-hidden="true">↑<br>N</span><div class="site-map-zoom" aria-label="Map zoom">'+button('+','zoom-in','aria-label="Zoom in"')+button('−','zoom-out','aria-label="Zoom out"')+'</div><div class="site-map-scale" aria-hidden="true"></div></div></div><div class="site-map-google-surface" '+(mode==='satellite'?'':'hidden')+'><div class="site-map-google-canvas" role="region" aria-label="Satellite map"></div><div class="site-map-google-message" role="status">Loading Google Maps…</div></div><div class="site-map-selection" aria-live="polite"></div></div><p class="site-map-nearest hint"></p><details class="site-map-tips"><summary>Map tips & privacy</summary><p class="hint site-map-help">Drag to move · Pinch to zoom · Tap a row to open its details. Distances use the source coordinates. Device location is not saved.</p></details>'+((query&&!searchResults().length)||!rows.length?'<p class="plan-notice">No mapped rows match this search. Clear the filters to find a row.</p>':'')+'</section>';
  }
  function fit(rows=filtered()){
    const bounds=mapBounds(rows);if(!bounds)return;
    const all=mapBounds(geometry(),0);origin={e:all.minE,n:all.maxN};
    const surfaceHeight=svg?.clientHeight||420,surfaceWidth=svg?.clientWidth||350,cardSpace=selected===null?0:surfaceWidth>=700?40:300,availableHeight=Math.max(140,surfaceHeight-cardSpace),ratio=Math.max(1,surfaceWidth)/availableHeight,w=bounds.maxE-bounds.minE,h=bounds.maxN-bounds.minN,width=Math.max(w,h*ratio),height=width/Math.max(1,surfaceWidth)*surfaceHeight;
    view={x:(bounds.minE+bounds.maxE)/2-origin.e-width/2,y:origin.n-(bounds.minN+bounds.maxN)/2-width/ratio/2,width,height};
  }
  const xy=p=>[p[0]-origin.e,origin.n-p[1]];
  function center(p,close=false){if(!view||!origin)return;if(close&&view.width>140){view.height*=140/view.width;view.width=140;}const [x,y]=xy(p);view.x=x-view.width/2;view.y=y-view.height/2;}
  function zoom(factor,anchor){if(!view)return;const width=Math.max(18,Math.min(12000,view.width*factor)),height=width*view.height/view.width,c=anchor||[view.x+view.width/2,view.y+view.height/2],fractionX=(c[0]-view.x)/view.width,fractionY=(c[1]-view.y)/view.height;view={x:c[0]-fractionX*width,y:c[1]-fractionY*height,width,height};follow=false;paint();}
  function mapPoint(clientX,clientY){const bounds=svg.getBoundingClientRect();return [view.x+(clientX-bounds.left)/bounds.width*view.width,view.y+(clientY-bounds.top)/bounds.height*view.height];}
  function paint(){
    if(!root||!svg||!view||!origin)return;
    if(mode==='satellite'){satellite?.update(filtered(),selected);paintSelection(geometry().find(r=>r.rowNumber===selected));paintLocation();return;}
    svg.setAttribute('viewBox',[view.x,view.y,view.width,view.height].join(' '));svg.setAttribute('preserveAspectRatio','none');
    const rows=filtered(),selection=geometry().find(r=>r.rowNumber===selected&&(!filter||r.field===filter));
    const units=view.width/(svg.clientWidth||350),labels=[];
    let drawing='<defs><pattern id="site-map-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="#d3e4d9" stroke-width=".7" vector-effect="non-scaling-stroke"/></pattern></defs><rect x="'+view.x+'" y="'+view.y+'" width="'+view.width+'" height="'+view.height+'" fill="url(#site-map-grid)"/>';
    if(mode==='aerial'&&imagery){const b=imagery.meta.bounds,n=xy([b.minE,b.maxN]);drawing+='<image class="site-map-aerial-image" href="'+esc(imagery.url)+'" x="'+n[0]+'" y="'+n[1]+'" width="'+(b.maxE-b.minE)+'" height="'+(b.maxN-b.minN)+'" preserveAspectRatio="none"/>';}
    for(const row of rows){const n=xy(row.north),s=xy(row.south),chosen=row.rowNumber===selected,p=planFor(row);const inView=n[0]>=view.x-10&&n[0]<=view.x+view.width+10&&s[1]>=view.y-10&&n[1]<=view.y+view.height+10;if(!inView)continue;
      drawing+='<g class="site-map-row" data-row-number="'+row.rowNumber+'"><title>Row '+row.rowNumber+' · '+esc(row.field)+'</title><path d="M'+n.join(' ')+'L'+s.join(' ')+'" stroke="'+(chosen?(mode==='aerial'?'#fff065':'#00875b'):(mode==='aerial'?'#c3e7ff':'#183b5c'))+'" stroke-width="'+(chosen?5:mode==='aerial'&&view.width>=300?.8:2)+'" vector-effect="non-scaling-stroke"/>';
      if(view.width<180)for(let i=0;i<(row.groups||[]).length;i++){const group=row.groups[i],gn=xy(group.north),gs=xy(group.south),type=(db().panelTypes||[]).find(t=>t.id===p?.panelGroups?.[i]?.typeId),colour=/^#[a-f0-9]{6}$/i.test(type?.color||'')?type.color:'#c5ced7';drawing+='<path d="M'+gn.join(' ')+'L'+gs.join(' ')+'" stroke="'+colour+'" stroke-width="2" vector-effect="non-scaling-stroke"/>'}
      if(view.width<300||chosen)labels.push({rowNumber:row.rowNumber,n,chosen});
      if(chosen&&row.drive&&point(row.drive.point)){const d=xy(row.drive.point);drawing+='<circle class="site-map-drive" cx="'+d[0]+'" cy="'+d[1]+'" r="'+units*4.2+'" fill="#ae3042"><title>Drive gap after panel '+row.drive.after+'</title></circle>';}
      if(chosen&&p?.dampersKnown)for(const damper of p.dampers||[]){const post=(row.posts||[]).find(post=>post.post===damper.post);if(!point(post?.point))continue;const q=xy(post.point),side=damper.side==='E'?1:-1;drawing+='<path d="M'+q.join(' ')+'h'+side*units*8+'" stroke="#b66300" stroke-width="2" vector-effect="non-scaling-stroke"/><circle cx="'+(q[0]+side*units*8)+'" cy="'+q[1]+'" r="'+units*3+'" fill="#efae32"><title>Damper · Post '+esc(damper.post)+' · '+esc(damper.side==='E'?'East':'West')+'</title></circle>';}
      drawing+='</g>';
    }
    const surface=svg.getBoundingClientRect(),overlaps=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top,occupied=[...root.querySelectorAll('.site-map-north,.site-map-zoom,.site-map-scale,.site-map-row-card')].map(node=>{const r=node.getBoundingClientRect();return {left:r.left-surface.left-4,right:r.right-surface.left+4,top:r.top-surface.top-4,bottom:r.bottom-surface.top+4};});
    labels.sort((a,b)=>Number(b.chosen)-Number(a.chosen));
    for(const label of labels){const font=label.chosen?13:12,width=font*(String(label.rowNumber).length*.75+.6),half=width/2;let x=(label.n[0]-view.x)/units,y=(label.n[1]-view.y)/units-font;
      if(label.chosen){x=Math.max(half+4,Math.min(surface.width-half-4,x));y=Math.max(font*1.2+4,Math.min(surface.height-font*.3-4,y));}
      let box={left:x-half,right:x+half,top:y-font*1.2,bottom:y+font*.3};
      if(label.chosen)for(const obstacle of occupied)if(overlaps(box,obstacle)){y=obstacle.bottom+font*1.2+4;box={...box,top:y-font*1.2,bottom:y+font*.3};}
      if(box.left<4||box.right>surface.width-4||box.top<4||box.bottom>surface.height-4||occupied.some(other=>overlaps(box,other)))continue;
      occupied.push(box);drawing+='<text data-row-label="'+label.rowNumber+'" x="'+(view.x+x*units)+'" y="'+(view.y+y*units)+'" text-anchor="middle" font-size="'+font*units+'" font-weight="'+(label.chosen?700:400)+'" fill="'+(label.chosen?'#006b49':'#152840')+'"'+(mode==='aerial'?' stroke="#fff" stroke-width="'+units*3+'" paint-order="stroke"':'')+'>'+label.rowNumber+'</text>';
    }
    if(view.width>=300)for(const field of [...new Set(rows.map(r=>r.field))]){const bounds=mapBounds(rows.filter(r=>r.field===field),0);if(!bounds)continue;const p=xy([(bounds.minE+bounds.maxE)/2,bounds.maxN]);drawing+='<text x="'+p[0]+'" y="'+(p[1]-units*12)+'" text-anchor="middle" font-size="'+units*14+'" font-weight="750" fill="#006b49" stroke="#fff" stroke-width="'+units*3+'" paint-order="stroke">'+esc(field)+'</text>';}
    drawing+='<g class="site-map-user"></g>';svg.innerHTML=drawing;
    const scale=root.querySelector('.site-map-scale'),target=view.width/4,power=10**Math.floor(Math.log10(target)),unit=target/power>=5?5:target/power>=2?2:1,metres=unit*power;scale.style.width=Math.max(1,metres/view.width*(svg.clientWidth||350))+'px';scale.textContent=metres>=1000?metres/1000+' km':metres+' m';
    paintSelection(selection);paintLocation();
  }
  function paintSelection(row){
    const host=root.querySelector('.site-map-selection');
    if(!row){host.innerHTML='';selectionKey=null;return;}
    const plan=planFor(row),type=(db().panelTypes||[]).find(t=>t.id===plan?.panelTypeId),count=plan?.panelCount??row.panelCount;
    const key=JSON.stringify([row,plan,type,fieldRole]);if(selectionKey===key&&host.firstElementChild)return;selectionKey=key;
    const groups=(plan?.panelGroups||[]).map(g=>'<span class="site-map-polarity">'+esc(g.quantity)+' '+(g.positiveSide==='N'?'↑ +N':g.positiveSide==='S'?'↓ +S':'? +')+'</span>').join('');
    const color=/^#[a-f0-9]{6}$/i.test(type?.color||'')?type.color:'#c5ced7',mixed=new Set((plan?.panelGroups||[]).map(g=>g.typeId)).size>1;
    const motor=plan?.motorAfterPanel==null?'Pending':'After '+esc(plan.motorAfterPanel);
    const details=(plan?.panelGroups||[]).map((g,i)=>{const t=(db().panelTypes||[]).find(t=>t.id===g.typeId);return '<small>Group '+(i+1)+' · '+esc(t?.description||'Description pending')+' · Current Class '+esc(t?.currentClass||'pending')+' · '+esc(g.sourceToken||'Marking pending')+'</small>';}).join('');
    host.innerHTML='<section class="site-map-row-card" aria-label="Selected row '+row.rowNumber+'"><div class="site-map-sheet-heading"><div><small>'+esc(row.field)+'</small><h3>Row '+row.rowNumber+'</h3></div>'+button('×','dismiss','class="site-map-sheet-close" aria-label="Close row card"')+'</div><div class="site-map-sheet-type"><span style="background:'+color+'" aria-hidden="true"></span>'+esc(type?.name||'Type pending')+(mixed?' · Mixed types':'')+'</div><div class="site-map-sheet-facts"><div><strong>'+esc(count??'?')+'</strong><small>Panels</small></div><div><strong>'+esc(plan?.damperCount??'?')+'</strong><small>Dampers</small></div><div><strong>'+motor+'</strong><small>Motor · panel</small></div></div>'+(groups?'<div class="site-map-sheet-polarity" aria-label="Panel groups from north to south">'+groups+'</div>':'<small>Panel directions pending</small>')+'<details class="site-map-sheet-details"><summary>IDs & installation details</summary>'+details+'<small>Pile plan row '+esc(row.pilePlanRow??'pending')+' · Motor post '+esc(row.motor?.post??'pending')+' · ID '+esc(row.motor?.id??'pending')+'</small>'+(plan?.dampersKnown?'<small>Dampers: '+plan.dampers.map(d=>esc(d.post)+' '+esc(d.side==='E'?'East':'West')).join(' · ')+'</small>':'')+'</details>'+(plan&&plan.panelCount!==row.panelCount?'<p class="plan-notice">Plan changed since import. Map uses the source layout.</p>':'')+(plan?'<div class="site-map-row-actions">'+(root.classList?.contains('site-map-field')&&fieldRole==='driver'?button('Driver view · Pallets','driver','class="primary"'):button('Open row','open','class="secondary"')+button('Pallets','pallets','class="primary"'))+'</div>':'<small>Installation plan is unavailable.</small>')+'</section>';
  }
  function paintLocation(){
    if(!visible||!root||!svg)return;
    const state=tracker.state(),p=state.fix&&projectLocation(state.fix,source()?.crs,projection()),status=root.querySelector('.site-map-status'),nearest=root.querySelector('.site-map-nearest'),user=svg.querySelector('.site-map-user');
    if(mode==='satellite')satellite?.showLocation(state.fix,{follow:follow&&state.enabled});
    status.textContent=messages[state.status]||messages.idle;status.dataset.state=state.status;
    if(state.fix)status.textContent+=' · Accuracy ±'+Math.ceil(state.fix.accuracy)+' m · Updated '+new Date(state.fix.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
    if(user)user.innerHTML='';nearest.textContent='';
    if(p&&view&&origin){if(mode!=='satellite'){const [x,y]=xy(p),radius=state.fix.accuracy,units=view.width/(svg.clientWidth||350);user.innerHTML='<circle class="site-map-accuracy" cx="'+x+'" cy="'+y+'" r="'+radius+'" fill="#2187ff22" stroke="#2187ff" stroke-width="1" vector-effect="non-scaling-stroke"/><circle class="site-map-dot" cx="'+x+'" cy="'+y+'" r="'+units*6+'" fill="#1674e9" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke"><title>You are here. Accuracy ±'+Math.ceil(radius)+' metres.</title></circle>';}
      const match=nearestRow(p,geometry());if(match)nearest.textContent=match.distance>100?'Your reported position is outside the row area.':'Nearest row centreline: '+match.row.rowNumber+' · '+Math.round(match.distance)+' m. Accuracy ±'+Math.ceil(state.fix.accuracy)+' m; confirm the row number on site.';
    }
    root.querySelector('[data-map-action="follow"]').setAttribute('aria-pressed',String(follow&&state.enabled));root.querySelector('[data-map-action="stop"]').hidden=!state.enabled;
    const unavailable=mode==='satellite'&&!['ready','alignment'].includes(satelliteState);for(const action of ['locate','follow'])root.querySelector('[data-map-action="'+action+'"]').disabled=unavailable;
    if(svg&&view)svg.setAttribute('viewBox',[view.x,view.y,view.width,view.height].join(' '));
  }
  function clearSelection(){selected=null;paintSelection(null);if(mode==='satellite')satellite?.update(filtered(),null,{focus:false});}
  function revealSelection(){const host=root;if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>{if(visible&&root===host&&selected!==null)host.querySelector('.site-map-stage')?.scrollIntoView({block:'center'});});}
  function select(row,focus=true){if(!row)return;selected=row.rowNumber;follow=false;if(mode==='satellite'){satellite.update(filtered(),selected,{focus});paintSelection(row);paintLocation();}else{if(focus)fit([row]);paint();}if(focus&&!root.classList?.contains('site-map-field'))revealSelection();}
  function updateModeCopy(){
    const notice=root.querySelector('.site-map-alignment');if(notice)notice.textContent=mode==='satellite'?'Row outlines await the project coordinate system. Phone GPS is available.':'GPS for rows awaits the project coordinate system.';
    root.querySelector('.site-map-help').textContent=mode==='satellite'?'Use two fingers to move the map · My position requests phone location. Row details and pallet placement remain available through search.':'Drag to move · Pinch to zoom · Tap a row to open its details. Distances use the source coordinates. Device location is not saved.';
  }
  function setMode(next){
    if(!root||next===mode||next==='satellite'&&(!satellite||api.isOffline?.())||next==='aerial'&&!api.hasImagery?.())return;
    tracker.stop();follow=false;mode=next;root.querySelector('.site-map-stage').dataset.view=mode;
    root.querySelector('.site-map-plan').hidden=mode==='satellite';root.querySelector('.site-map-google-surface').hidden=mode!=='satellite';
    for(const item of root.querySelectorAll('.site-map-view-switch button'))item.setAttribute('aria-pressed',String(item.dataset.mapAction==='view-'+mode));
    updateModeCopy();
    if(mode==='satellite'){satelliteState='loading';satellite.update(filtered(),selected,{focus:selected!==null});satellite.mount(root.querySelector('.site-map-google-canvas'));paintSelection(geometry().find(r=>r.rowNumber===selected));paintLocation();}
    else{satellite?.destroy();paint();if(mode==='aerial')void loadAerial();else{imageryEpoch++;imageryNote();}} 
    if(selected!==null&&!root.classList?.contains('site-map-field'))revealSelection();
  }
  function mount(host){
    abort?.abort();resize?.disconnect();if(timer)clearInterval(timer);root=host;svg=root?.querySelector('svg.site-map-svg');if(!root||!svg)return;
    visible=true;selectionKey=null;abort=new AbortController();const signal=abort.signal;
    updateModeCopy();
    if(mode==='satellite'){satelliteState='loading';satellite.update(filtered(),selected,{focus:selected!==null});satellite.mount(root.querySelector('.site-map-google-canvas'));}
    if(!view)fit();if(pendingRow){select(pendingRow);pendingRow=null;}else if(pendingSearch&&query&&searchResults().length===1)select(searchResults()[0]);else paint();pendingSearch=false;if(mode==='aerial')void loadAerial();
    if(typeof ResizeObserver==='function'){resize=new ResizeObserver(()=>{if(!visible||!view||!svg.clientWidth||!svg.clientHeight)return;const height=view.width*svg.clientHeight/svg.clientWidth;if(selected===null)view.y+=(view.height-height)/2;view.height=height;paint();});resize.observe(svg);}
    root.addEventListener('click',event=>{const action=event.target.closest('[data-map-action]')?.dataset.mapAction;if(!action)return;
      if(action==='role-worker'||action==='role-driver'){fieldRole=action==='role-driver'?'driver':'worker';for(const item of root.querySelectorAll('.field-map-roles button'))item.setAttribute('aria-pressed',String(item.dataset.mapAction==='role-'+fieldRole));paintSelection(geometry().find(r=>r.rowNumber===selected));}
      else if(['view-plan','view-aerial','view-satellite'].includes(action)){setMode(action.slice(5));}
      else if(action==='fit'){follow=false;selected=null;if(mode==='satellite'){satellite.update(filtered(),selected);satellite.fit();paintSelection(null);paintLocation();}else{fit();paint();}}
      else if(action==='dismiss'){selected=null;paintSelection(null);paint();root.querySelector('[data-map-action="'+('view-'+mode)+'"]')?.focus({preventScroll:true});}
      else if(action==='zoom-in'||action==='zoom-out')zoom(action==='zoom-in'?.6:1/.6);
      else if(action==='locate'){clearSelection();follow=true;const state=tracker.state();if(state.fix){const p=projectLocation(state.fix,source()?.crs,projection());if(p){center(p,true);paint();}}else tracker.start();}
      else if(action==='follow'){follow=!(follow&&tracker.state().enabled);if(follow){clearSelection();tracker.start();const fix=tracker.state().fix,p=fix&&projectLocation(fix,source()?.crs,projection());if(p)center(p,true);}paint();}
      else if(action==='stop'){follow=false;tracker.stop();}
      else if(['open','pallets','driver'].includes(action)){const row=geometry().find(r=>r.rowNumber===selected),plan=row&&planFor(row);if(plan)api.openRow(plan.id,action==='driver'?'driver':action==='pallets');}
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
  function hide(){imageryEpoch++;imagery=null;visible=false;abort?.abort();abort=null;resize?.disconnect();resize=null;if(timer)clearInterval(timer);timer=null;tracker.dispose();satellite?.destroy();mode='plan';follow=false;root=null;svg=null;}
  return {html,mount,hide,hasGeometry:()=>geometry().length>0,matches,selectRow:row=>{pendingRow=row;view=null;},tracker};
}
