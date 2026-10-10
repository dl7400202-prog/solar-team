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
  let host=null,map=null,maps=null,epoch=0,offFailure=null,abort=null,rows=[],selected=null,layers=[],rowLines=new Map(),position=null,accuracy=null,label=null,location=null,following=false,focusPending=false;
  const clearLayers=()=>{for(const layer of layers){maps?.event?.clearInstanceListeners(layer);layer.setMap(null);}layers=[];rowLines.clear();label?.setMap(null);label=null;};
  function report(state){onStatus(state);}
  function boundsFor(items){const bounds=new maps.LatLngBounds();let count=0;for(const row of items)for(const p of [row.north,row.south]){const converted=toLocation(p);if(converted){bounds.extend(converted);count++;}}return count?bounds:null;}
  function fit(items=rows){if(!map)return;const bounds=boundsFor(items);if(bounds)map.fitBounds(bounds,40);else report('alignment');}
  function highlight(){
    if(!map)return;
    for(const [number,entry]of rowLines)entry.line.setOptions({strokeColor:number===selected?'#00df98':entry.colour,strokeWeight:number===selected?6:3,zIndex:number===selected?5:1});
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
      const baseColour=colourFor(row,0),colour=/^#[a-f0-9]{6}$/i.test(baseColour||'')?baseColour:'#ffffff';
      const line=new maps.Polyline({map,path:[n,s],strokeColor:colour,strokeWeight:3,zIndex:1});line.addListener('click',()=>onSelect(row));layers.push(line);rowLines.set(row.rowNumber,{line,colour});
      if(row.rowNumber===selected)for(let i=0;i<(row.groups||[]).length;i++){const group=row.groups[i],gn=toLocation(group.north),gs=toLocation(group.south),colour=colourFor(row,i);if(gn&&gs&&/^#[a-f0-9]{6}$/i.test(colour||'')){const stripe=new maps.Polyline({map,path:[gn,gs],strokeColor:colour,strokeWeight:2,zIndex:2});stripe.addListener('click',()=>onSelect(row));layers.push(stripe);}}
      const motor=row.drive?.point&&toLocation(row.drive.point);if(motor){const mark=new maps.Circle({map,center:motor,radius:1.5,fillColor:'#ec6475',fillOpacity:1,strokeColor:'#ffffff',strokeWeight:1,zIndex:3});mark.addListener('click',()=>onSelect(row));layers.push(mark);}
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
  function update(nextRows,nextSelected,{focus=false}={}){const changed=rows!==nextRows;rows=nextRows;selected=nextSelected;focusPending=selected!==null&&(focus||(!map&&focusPending));if(!map)return;if(changed)drawRows();else highlight();if(focus){const row=rows.find(r=>r.rowNumber===selected);if(row)fit([row]);}focusPending=false;}
  function destroy(){epoch++;offFailure?.();offFailure=null;abort?.abort();abort=null;clearLayers();position?.setMap(null);accuracy?.setMap(null);position=null;accuracy=null;if(map){maps?.event?.clearInstanceListeners(map);map.unbindAll?.();}map=null;maps=null;location=null;following=false;host=null;}
  function mount(element){
    destroy();host=element;const token=++epoch;abort=new AbortController();const signal=abort.signal;
    const fail=()=>{if(token!==epoch)return;destroy();report('error');};
    offFailure=loader.onFailure(fail);report('loading');
    loader.load().then(result=>{
      if(token!==epoch||!host?.isConnected)return;
      maps=result;
      try{const instance=new maps.Map(host,{center:{lat:56,lng:10},zoom:6,mapTypeId:'satellite',mapTypeControl:true,mapTypeControlOptions:{mapTypeIds:['satellite','hybrid']},zoomControl:true,zoomControlOptions:{position:maps.ControlPosition?.TOP_RIGHT},fullscreenControl:false,streetViewControl:false,rotateControl:false,tilt:0,heading:0,gestureHandling:'cooperative',scaleControl:true,keyboardShortcuts:true});
        if(token!==epoch){result.event?.clearInstanceListeners(instance);instance.unbindAll?.();return;}map=instance;
        map.addListener('dragstart',onGesture);map.addListener('zoom_changed',sizePosition);
        host.addEventListener('pointerdown',onGesture,{signal});host.addEventListener('wheel',onGesture,{signal,passive:true});host.addEventListener('keydown',event=>{if(['+','-','=','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))onGesture();},{signal});
        drawRows();const row=rows.find(r=>r.rowNumber===selected);fit(row&&focusPending?[row]:rows);focusPending=false;showLocation(location,{follow:following});
      }catch{fail();}
    },fail);
  }
  return {mount,update,fit,showLocation,destroy,resize:()=>{if(map)maps.event?.trigger(map,'resize')}};
}
