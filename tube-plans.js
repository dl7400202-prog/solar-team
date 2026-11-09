/* Read-only installation instructions. Tube and panel colours are separate catalogues. */
export function createTubePlans(input) {
  const fields=Object.freeze(['North','Mid']);
  let activeData=null,bindings=new Map();
  function catalogue(){
    const value=typeof input==='function'?input():input;
    if(value!==activeData){activeData=value;bindings=new Map((value?.schema===1&&Array.isArray(value.rows)?value.rows:[]).filter(r=>Array.isArray(r)&&r.length===4).map(r=>[r[1]+'\0'+r[0],r]));}
    return value;
  }
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normaliseType=value=>String(value??'').trim().replace(/^#/,'').toUpperCase();
  const colours={Yellow:['Yellow','#e4c41a'],Purple:['Purple','#8643ad'],Blue:['Blue','#157cc0'],Green:['Green','#48994b'],Brown:['Brown','#92571d'],Metal:['Unpainted metal','#899ba7']};
  const messages={scope:'Tube instructions are only available for North and Mid.','unknown-row':'No source tube schedule has been supplied for this row.','row-type':'The row type differs from the source tube schedule.','panel-count':'The panel count differs from the source tube schedule.','invalid-template':'The source tube schedule is incomplete.'};
  function get(plan) {
    const data=catalogue();
    if(!plan||!fields.includes(plan.field))return {available:false,reason:'scope'};
    const row=bindings.get(plan.field+'\0'+plan.rowNumber);
    if(!row)return {available:false,reason:'unknown-row'};
    if(normaliseType(plan.rowType)!==row[2])return {available:false,reason:'row-type'};
    if(plan.panelCount!==row[3])return {available:false,reason:'panel-count'};
    const source=data.templates?.[row[2]],raw=source?.tubes;
    const bad=()=>({available:false,reason:'invalid-template'});
    if(!Array.isArray(raw)||!raw.length)return bad();
    const tubes=[],bearings=[],drives=[];
    for(const [i,t] of raw.entries()){
      if(!colours[t.colour]||!Number.isSafeInteger(t.lengthMm)||t.lengthMm<=0||typeof t.part!=='string'||!Array.isArray(t.bearings))return bad();
      const tube={index:i+1,colour:t.colour,lengthMm:t.lengthMm,part:t.part,bearings:[],driveFromNorthMm:t.driveFromNorthMm};
      for(const b of t.bearings){
        if(!['bearing','fixed'].includes(b.kind)||!Number.isSafeInteger(b.fromNorthMm)||b.fromNorthMm<0||b.fromNorthMm>t.lengthMm)return bad();
        const bearing={tube:i+1,kind:b.kind,fromNorthMm:b.fromNorthMm};tube.bearings.push(bearing);bearings.push(bearing);
      }
      if(t.driveFromNorthMm!==null){
        if(!Number.isSafeInteger(t.driveFromNorthMm)||t.driveFromNorthMm<0||t.driveFromNorthMm>t.lengthMm)return bad();
        drives.push({tube:i+1,fromNorthMm:t.driveFromNorthMm});
      }
      tubes.push(tube);
    }
    if(drives.length!==1||!tubes[0].bearings.length||!tubes.at(-1).bearings.length)return bad();
    const drive=drives[0],compare=(a,b)=>a.tube-b.tube||a.fromNorthMm-b.fromNorthMm;
    for(const b of bearings)if(compare(b,drive)===0)return bad();
    for(const side of ['N','S']){
      const list=bearings.filter(b=>side==='N'?compare(b,drive)<0:compare(b,drive)>0).sort(side==='N'?(a,b)=>compare(b,a):compare);
      list.forEach((b,i)=>Object.assign(b,{side,ordinalFromDrive:i+1,code:side+(i+1)}));
    }
    return {available:true,type:row[2],tubes,bearings,drive,
      joins:tubes.slice(1).map((t,i)=>({northTube:i+1,southTube:i+2,part:'20764 series'})),
      northOverhangMm:Math.min(...tubes[0].bearings.map(b=>b.fromNorthMm)),
      southOverhangMm:tubes.at(-1).lengthMm-Math.max(...tubes.at(-1).bearings.map(b=>b.fromNorthMm)),
      source:{...data.source,page:source.page}};
  }
  function sourceDetails(result) {
    return '<details class="plan-source tube-source"><summary>Tube source</summary><p>'+esc(result.source.document)+' · Rev. '+esc(result.source.revision)+' · '+esc(result.source.date)+' · <span>Page '+esc(result.source.page)+'</span> · <span>Type #'+esc(result.type)+'</span></p><p>Set-screw bearing: 21022-300. Floating bearing: 21023-300.</p><p>South-end distance is calculated from the last tube length.</p></details>';
  }
  function renderLayout(result,metres) {
    const fixed=['N','S'].map(side=>result.bearings.filter(b=>b.side===side&&b.kind==='fixed').sort((a,b)=>a.ordinalFromDrive-b.ordinalFromDrive).map(b=>b.code).join(', ')).filter(Boolean).join(' · ');
    const tubes=result.tubes.map(t=>{
      const points=[...t.bearings.map(b=>({...b,drive:false})),...(t.index===result.drive.tube?[{...result.drive,drive:true}]:[])];
      const marks=points.map(p=>'<span class="tube-bearing '+(p.drive?'tube-gcs':p.kind==='fixed'?'tube-fixed':'tube-floating')+'" style="top:'+(p.fromNorthMm/t.lengthMm*100).toFixed(3)+'%" role="img" aria-label="'+esc(p.drive?'GCS drive':p.code+' · '+(p.kind==='fixed'?'With set screws':'Without set screws'))+'"><span class="tube-bearing-code">'+esc(p.drive?'GCS':p.code)+'</span></span>').join('');
      return '<div class="tube-section'+(t.index===result.drive.tube?' tube-drive-section':'')+'" data-tube-index="'+t.index+'"><div aria-hidden="true"></div><div class="tube-axis"><div class="tube-body" style="--tube-colour:'+colours[t.colour][1]+'"></div>'+marks+'</div><div class="tube-spec"><small><span>Tube '+t.index+'</span> · '+metres(t.lengthMm,1)+' <span>m</span></small><strong>'+colours[t.colour][0]+'</strong><small class="tube-part">'+esc(t.part)+'</small>'+(t.index===result.drive.tube?'<small class="tube-drive-caption">Tube with GCS</small>':'')+'</div></div>'+(t.index<result.tubes.length?'<div class="tube-joint" data-tube-joint="'+t.index+'" role="img" aria-label="Coupler: '+t.index+' / '+(t.index+1)+'"><span></span></div>':'');
    }).join('');
    return '<section class="card tube-sheet"><h2>Tube layout</h2><p class="hint">Tubes run from north to south. Bearing numbers start at GCS on each side.</p><div class="tube-legend"><span><i class="tube-key tube-key-fixed" aria-hidden="true"></i><span>With set screws</span></span><span><i class="tube-key" aria-hidden="true"></i><span>Without set screws</span></span><span><i class="tube-key tube-key-joint" aria-hidden="true"></i><span>Coupler</span></span></div><p class="tube-fixed-summary"><span>Fixed bearings</span>: '+esc(fixed||'None')+'</p><p class="tube-north">↑ N · <span>North end</span></p><div class="tube-chain">'+tubes+'</div><p class="tube-south">↓ S · <span>South end</span></p><p class="hint">N1 and S1 are nearest GCS; numbers increase towards each end.</p><p class="hint">Schematic only. Distances are not to scale.</p></section>';
  }
  function renderEnds(result,metres) {
    return '<section class="card tube-sheet"><h2>Extreme bearings</h2><p class="hint">Distance from the extreme bearing to the tube end</p><div class="tube-end-label">↑ N · <span>North end</span></div><div class="tube-ends" role="group" aria-label="Extreme bearing distances"><div class="tube-end-piece tube-end-north" aria-hidden="true"></div><div class="tube-end-piece tube-end-south" aria-hidden="true"></div><span class="tube-end-bearing tube-end-north" aria-hidden="true"></span><span class="tube-end-bearing tube-end-south" aria-hidden="true"></span><div class="tube-end-measure tube-end-north"><strong class="tube-end-value">'+metres(result.northOverhangMm,2)+' <span>m</span></strong></div><div class="tube-end-measure tube-end-south"><strong class="tube-end-value">'+metres(result.southOverhangMm,2)+' <span>m</span></strong></div><span class="tube-end-name tube-end-north">Northernmost bearing</span><span class="tube-end-name tube-end-south">Southernmost bearing</span><span class="tube-end-break" aria-hidden="true">//</span><small class="tube-end-break-label">Row shortened</small></div><div class="tube-end-label">↓ S · <span>South end</span></div><p class="hint">Schematic only. Distances are not to scale.</p></section>';
  }
  function render(plan,view='layout',{locale='en'}={}) {
    const result=get(plan);
    if(!result.available)return '<section class="card tube-unavailable"><h2>Tube instructions unavailable</h2><p>'+messages[result.reason]+'</p></section>';
    const metres=(mm,decimals)=>new Intl.NumberFormat(locale==='ru'?'ru-RU':'en-GB',{minimumFractionDigits:decimals===2?2:0,maximumFractionDigits:decimals}).format(mm/1000);
    const tabs='<div class="plan-tabs tube-views" role="group" aria-label="Tube view">'+[['layout','Layout'],['ends','End distances']].map(([key,label])=>'<button type="button" data-action="plan-tube-view" data-id="'+key+'" aria-pressed="'+(view===key)+'" class="'+(view===key?'active':'')+'">'+label+'</button>').join('')+'</div>';
    return '<div class="tube-installation">'+tabs+'<div aria-live="polite">'+(view==='ends'?renderEnds(result,metres):renderLayout(result,metres))+'</div>'+sourceDetails(result)+'</div>';
  }
  return {fields,get,render};
}
