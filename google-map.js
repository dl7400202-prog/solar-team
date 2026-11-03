/* Google is loaded only when the signed-in user selects Satellite. */
const mapError=code=>Object.assign(new Error('Google Maps is unavailable.'),{code});
export function createGoogleMapsLoader({key,document=globalThis.document,scope=globalThis,timeoutMs=15000}) {
  let pending=null,maps=null,failure=null,rejectLoad=null;
  const listeners=new Set();
  function fail(error){failure=error;rejectLoad?.(error);for(const listener of listeners)listener(error);}
  function load(){
    if(failure)return Promise.reject(failure);
    if(maps)return Promise.resolve(maps);
    if(pending)return pending;
    if(!key||!document?.head)return Promise.reject(mapError('configuration'));
    pending=new Promise((resolve,reject)=>{
      const script=document.createElement('script'),callback='__solarTeamMapsReady';let settled=false;
      const finish=(error)=>{if(settled)return;settled=true;scope.clearTimeout(timer);rejectLoad=null;if(error){script.remove();reject(error);}else{maps=scope.google?.maps;if(typeof maps?.Map!=='function'){reject(mapError('network'));return;}resolve(maps);}};
      rejectLoad=finish;
      const timer=scope.setTimeout(()=>finish(mapError('timeout')),timeoutMs);
      scope[callback]=()=>finish();
      const previous=scope.gm_authFailure;
      scope.gm_authFailure=()=>{fail(mapError('authorization'));if(typeof previous==='function')previous();};
      script.async=true;
      script.src='https://maps.googleapis.com/maps/api/js?'+new URLSearchParams({key,loading:'async',callback,v:'quarterly',language:'en',region:'DK',auth_referrer_policy:'origin'});
      script.onerror=()=>finish(mapError('network'));
      document.head.append(script);
    });
    return pending;
  }
  return {load,onFailure:listener=>{listeners.add(listener);return ()=>listeners.delete(listener)}};
}

export function createGoogleSatelliteMap({loader,toLocation,colourFor=()=>null,onSelect=()=>{},onGesture=()=>{},onStatus=()=>{}}) {
  let host=null,map=null,maps=null,epoch=0,offFailure=null,abort=null,rows=[],selected=null,layers=[],rowLines=new Map(),position=null,accuracy=null,label=null,location=null,following=false,focusPending=false,camera=null,resetCamera=false,halo=null;
  const clearLayers=()=>{for(const layer of layers){maps?.event?.clearInstanceListeners(layer);layer.setMap(null);}layers=[];rowLines.clear();halo?.setMap(null);halo=null;label?.setMap(null);label=null;};
  function report(state){onStatus(state);}
  function boundsFor(items){const bounds=new maps.LatLngBounds();let count=0;for(const row of items)for(const p of [row.north,row.south]){const converted=toLocation(p);if(converted){bounds.extend(converted);count++;}}return count?bounds:null;}
  function fit(items=rows){if(!map)return;const bounds=boundsFor(items);if(bounds)map.fitBounds(bounds,40);else report('alignment');}
  function rowWidth(){const lat=map?.getCenter?.()?.lat?.()??56,zoom=map?.getZoom?.()??16,units=156543.03392*Math.cos(lat*Math.PI/180)/2**zoom;return Math.max(1.8,Math.min(7,3.2/(Number.isFinite(units)&&units>0?units:2)));}
  function styleRows(){
    if(!map)return;const width=rowWidth();
    for(const [number,entry]of rowLines)for(const band of entry.bands)band.setOptions({strokeWeight:width,strokeOpacity:1,zIndex:number===selected?6:2});
    halo?.setOptions({strokeWeight:width+3});
  }
  function highlight(){
    if(!map)return;
    halo?.setMap(null);halo=null;const chosen=rows.find(r=>r.rowNumber===selected);if(chosen){const n=toLocation(chosen.north),s=toLocation(chosen.south);if(n&&s)halo=new maps.Polyline({map,path:[n,s],strokeColor:'#ffffff',strokeOpacity:1,strokeWeight:rowWidth()+3,clickable:false,zIndex:5});}styleRows();
    label?.setMap(null);label=null;
    const row=rows.find(r=>r.rowNumber===selected),p=row&&toLocation(row.north);
    if(p&&typeof maps.OverlayView==='function'){
      const node=host.ownerDocument.createElement('div');node.className='site-map-google-row-label';node.textContent='Row '+row.rowNumber;
      const overlay=new maps.OverlayView();overlay.onAdd=()=>overlay.getPanes().floatPane.append(node);
      overlay.draw=()=>{const pixel=overlay.getProjection()?.fromLatLngToDivPixel(new maps.LatLng(p));if(pixel){node.style.left=pixel.x+'px';node.style.top=pixel.y+'px';}};
      overlay.onRemove=()=>node.remove();label=overlay;overlay.setMap(map);
    }
  }
  function drawRows(){
    if(!map)return;
    clearLayers();
    for(const row of rows){const n=toLocation(row.north),s=toLocation(row.south);if(!n||!s)continue;
      const colour=index=>{const value=colourFor(row,index);return /^#[a-f0-9]{6}$/i.test(value||'')?value:'#c5ced7';};
      let parts=(row.groups||[]).map((group,index)=>({north:group.north&&toLocation(group.north),south:group.south&&toLocation(group.south),colour:colour(index)})).filter(g=>g.north&&g.south);
      if(!parts.length||parts.every(g=>g.colour===parts[0].colour))parts=[{north:n,south:s,colour:parts[0]?.colour||colour(0)}];
      const bands=parts.map(part=>{const band=new maps.Polyline({map,path:[part.north,part.south],strokeColor:part.colour,strokeOpacity:1,strokeWeight:rowWidth(),zIndex:2});band.addListener('click',()=>onSelect(row));layers.push(band);return band;});rowLines.set(row.rowNumber,{bands});
      const motor=row.drive?.point&&toLocation(row.drive.point);if(motor){const mark=new maps.Circle({map,center:motor,radius:1.5,fillColor:'#ec6475',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:1,zIndex:row.rowNumber===selected?7:3});mark.addListener('click',()=>onSelect(row));layers.push(mark);}
    }
    highlight();
    report(rowLines.size?'ready':'alignment');
  }
  function showLocation(fix,{follow=false}={}){
    location=fix;following=follow;
    if(!map)return;
    if(!fix){position?.setMap(null);accuracy?.setMap(null);position=null;accuracy=null;return;}
    const centre={lat:fix.latitude,lng:fix.longitude};
    if(!accuracy)accuracy=new maps.Circle({map,clickable:false,fillColor:'#2187ff',fillOpacity:.15,strokeColor:'#2187ff',strokeOpacity:.6,strokeWeight:1,zIndex:8});
    accuracy.setCenter(centre);accuracy.setRadius(fix.accuracy);accuracy.setMap(map);
    if(!position)position=new maps.Circle({map,clickable:false,fillColor:'#1674e9',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:2,zIndex:9});
    position.setCenter(centre);position.setMap(map);sizePosition();
    if(follow){map.panTo(centre);if(map.getZoom()<18)map.setZoom(18);}
  }
  function sizePosition(){if(position&&location&&map)position.setRadius(6*156543.03392*Math.cos(location.latitude*Math.PI/180)/2**map.getZoom());}
  function update(nextRows,nextSelected,{focus=false,resetView=false}={}){const changed=rows!==nextRows;if(resetView){camera=null;resetCamera=true;}rows=nextRows;selected=nextSelected;focusPending=selected!==null&&(focus||(!map&&focusPending));if(!map)return;if(changed)drawRows();else highlight();if(focus){const row=rows.find(r=>r.rowNumber===selected);if(row)fit([row]);}focusPending=false;}
  function destroy(){if(map){const centre=map.getCenter?.(),zoom=map.getZoom?.(),lat=centre?.lat?.(),lng=centre?.lng?.();if([lat,lng,zoom].every(Number.isFinite))camera={center:{lat,lng},zoom};}epoch++;offFailure?.();offFailure=null;abort?.abort();abort=null;clearLayers();position?.setMap(null);accuracy?.setMap(null);position=null;accuracy=null;if(map){maps?.event?.clearInstanceListeners(map);map.unbindAll?.();}map=null;maps=null;location=null;following=false;host=null;}
  function mount(element){
    destroy();if(resetCamera){camera=null;resetCamera=false;}host=element;const token=++epoch;abort=new AbortController();const signal=abort.signal;
    const fail=()=>{if(token!==epoch)return;destroy();report('error');};
    offFailure=loader.onFailure(fail);report('loading');
    loader.load().then(result=>{
      if(token!==epoch||!host?.isConnected)return;
      maps=result;
      try{const instance=new maps.Map(host,{center:camera?.center||{lat:56,lng:10},zoom:camera?.zoom??6,mapTypeId:'satellite',mapTypeControl:false,zoomControl:false,cameraControl:false,disableDefaultUI:true,fullscreenControl:false,streetViewControl:false,rotateControl:false,tilt:0,heading:0,gestureHandling:'greedy',scaleControl:true,keyboardShortcuts:true});
        if(token!==epoch){result.event?.clearInstanceListeners(instance);instance.unbindAll?.();return;}map=instance;
        map.addListener('dragstart',onGesture);map.addListener('zoom_changed',()=>{sizePosition();styleRows();});
        host.addEventListener('pointerdown',onGesture,{signal});host.addEventListener('wheel',onGesture,{signal,passive:true});host.addEventListener('keydown',event=>{if(['+','-','=','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))onGesture();},{signal});
        drawRows();const row=rows.find(r=>r.rowNumber===selected);if(focusPending||!camera)fit(row&&focusPending?[row]:rows);focusPending=false;showLocation(location,{follow:following});
      }catch{fail();}
    },fail);
  }
  return {mount,update,fit,showLocation,destroy,zoom:delta=>{if(map&&Number.isFinite(delta)){onGesture();map.setZoom(Math.max(1,Math.min(22,map.getZoom()+delta)));}},resize:()=>{if(map)maps.event?.trigger(map,'resize')}};
}
