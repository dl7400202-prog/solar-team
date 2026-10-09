/* Row installation plans are shared specifications; completion stays in Record work. */
const ROUTES = new Set(['rowPlans', 'rowPlan', 'rowPlanEdit', 'panelTypes', 'panelTypeEdit', 'rowPlanImport']);
const MAX_INT = 2147483647;
const copy = value => structuredClone(value);
const present = value => value !== null && value !== undefined && String(value).trim() !== '';
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= MAX_INT;
const colorValue = value => /^#[0-9a-f]{6}$/i.test(value || '') ? value : '#c5ced7';
const numberValue = value => !present(value) ? null : Number(String(value).replace(',', '.'));
const panelIdentity = type => `${type?.description || ''}\u0000${type?.currentClass || ''}`.toLowerCase();

export function validatePanelType(item, types = []) {
  if (!item || typeof item !== 'object') return 'A panel type is required.';
  if (!['yellow', 'type-2', 'type-3', 'type-4', 'type-5', 'type-6', 'type-7'].includes(item.id)) return 'Choose one of the seven panel type slots.';
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 120) return 'Enter a panel type name (up to 120 characters).';
  if (typeof item.configured !== 'boolean') return 'Specify whether the type is ready to use.';
  if (item.color !== null && !/^#[0-9a-f]{6}$/i.test(item.color || '')) return 'Enter a six-digit colour, for example #f3cf35.';
  if (typeof item.description !== 'string' || typeof item.currentClass !== 'string' || item.description.length > 160 || item.currentClass.length > 32) return 'Check Description and Current Class.';
  if (item.configured && (!item.color || !item.description.trim() || !item.currentClass.trim())) return 'A usable type needs colour, Description and Current Class.';
  if (item.configured && types.some(t => t.id !== item.id && t.configured && panelIdentity(t) === panelIdentity(item))) return 'This Description + Current Class already belongs to another panel type.';
  return '';
}

export function validateRowPlan(item, fields = [], types = []) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'Each plan must be an object.';
  if (!item.id || typeof item.id !== 'string' || item.id.length > 160) return 'Each plan needs an ID (up to 160 characters).';
  if (!fields.includes(item.field)) return 'Choose an existing field.';
  if (!integer(item.rowNumber)) return 'Enter a whole row number from 0 to 2147483647.';
  if (typeof item.rowType !== 'string' || item.rowType.length > 40) return 'Check the row type (up to 40 characters).';
  if (!types.some(t => t.id === item.panelTypeId)) return 'Choose a valid panel type.';
  if (!['verified', 'partial', 'needs_review'].includes(item.status)) return 'Choose Verified, Awaiting information or Needs review.';
  if (typeof item.panelsKnown !== 'boolean' || typeof item.dampersKnown !== 'boolean') return 'Specify whether panel and damper instructions are known.';
  if (item.panelCount !== null && (!integer(item.panelCount) || item.panelCount > 10000)) return 'Panel count must be blank or a whole number up to 10000.';
  if (item.damperCount !== null && (!integer(item.damperCount) || item.damperCount > 100)) return 'Damper count must be blank or a whole number up to 100.';
  if (!Array.isArray(item.panelGroups) || item.panelGroups.length > 100) return 'Use up to 100 panel groups.';
  let quantity = 0;
  for (const group of item.panelGroups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return 'Every panel group must be an object.';
    if (!integer(group.quantity) || group.quantity < 1 || group.quantity > 10000) return 'Every panel group needs a positive whole quantity up to 10000.';
    if (!['N', 'S', null].includes(group.positiveSide)) return 'Panel direction must be North, South or Not confirmed.';
    if (!types.some(t => t.id === group.typeId)) return 'Every group needs a valid panel type.';
    if (typeof group.sourceToken !== 'string' || group.sourceToken.length > 160) return 'Check each group’s original source marking.';
    quantity += group.quantity;
  }
  if (quantity > 10000) return 'The panel groups exceed 10000 panels.';
  if (item.panelCount !== null && quantity > item.panelCount) return 'The group quantities exceed the row’s panel count.';
  if (item.panelsKnown && (item.panelCount === null || quantity !== item.panelCount)) return 'Known panel instructions need a panel count matching the sum of groups.';
  if (!item.panelsKnown && (item.panelCount !== null || item.panelGroups.length)) return 'Confirm that the panel count and groups are supplied, or leave the unknown panel section blank.';
  if (!Array.isArray(item.dampers) || item.dampers.length > 100) return 'Use up to 100 damper positions.';
  const positions = new Set();
  for (const damper of item.dampers) {
    if (!damper || typeof damper !== 'object' || Array.isArray(damper)) return 'Every damper position must be an object.';
    if (!integer(damper.post) || damper.post < 1 || !['E', 'W'].includes(damper.side)) return 'Every damper needs a positive post number and East/West side.';
    const position = `${damper.post}-${damper.side}`;
    if (positions.has(position)) return 'The same post and side appears twice in the damper list.';
    positions.add(position);
  }
  if (item.damperCount !== null && item.dampers.length > item.damperCount) return 'The damper positions exceed the declared count.';
  if (item.dampersKnown && (item.damperCount === null || item.dampers.length !== item.damperCount)) return 'Known damper instructions need a count matching the positions.';
  if (!item.dampersKnown && (item.damperCount !== null || item.dampers.length)) return 'Confirm that the damper instructions are supplied, or leave the unknown damper section blank.';
  if (item.slope !== null && (!Number.isFinite(item.slope) || Math.abs(item.slope) > 90)) return 'Slope must be blank or between -90 and 90 degrees.';
  if (item.lowerBearingSide !== null && (typeof item.lowerBearingSide !== 'string' || item.lowerBearingSide.length > 80)) return 'Check the lower bearing side (up to 80 characters).';
  if (item.motorAfterPanel !== null && (!integer(item.motorAfterPanel) || item.motorAfterPanel < 1 || item.panelCount === null || item.motorAfterPanel > item.panelCount)) return 'Motor position needs a known panel count and a panel number within the row.';
  if (!Array.isArray(item.pallets) || item.pallets.length > 100) return 'Use up to 100 pallet positions.';
  for (const pallet of item.pallets) {
    if (!pallet || typeof pallet !== 'object' || Array.isArray(pallet)) return 'Every pallet position must be an object.';
    if (!integer(pallet.panels) || pallet.panels < 1 || pallet.panels > 10000 || !integer(pallet.adjacentRow) || !integer(pallet.afterPanel) || pallet.afterPanel < 1 || item.panelCount === null || pallet.afterPanel > item.panelCount) return 'Each pallet needs a positive panel quantity, adjacent row number and position within a known row panel count.';
    if (pallet.adjacentRow === item.rowNumber) return 'A pallet’s adjacent row must differ from the selected row.';
  }
  if (item.status === 'verified' && (!item.panelsKnown || !item.dampersKnown || item.panelGroups.some(g => !g.positiveSide || !types.find(t => t.id === g.typeId)?.configured) || !types.find(t => t.id === item.panelTypeId)?.configured)) return 'Verified plans need complete panel and damper instructions, confirmed directions and configured panel types.';
  if (item.status === 'partial' && (item.panelGroups.some(g => !g.positiveSide || !types.find(t => t.id === g.typeId)?.configured) || (item.panelGroups.length && !item.panelsKnown) || (item.dampers.length && !item.dampersKnown))) return 'Awaiting information is for complete supplied sections. Use Needs review when existing instructions are uncertain.';
  if (item.status === 'partial' && (item.panelsKnown && item.dampersKnown)) return 'Both sections are supplied. Choose Verified or Needs review.';
  if (typeof item.notes !== 'string' || item.notes.length > 5000 || !item.source || typeof item.source.panels !== 'string' || typeof item.source.dampers !== 'string' || item.source.panels.length > 1000 || item.source.dampers.length > 1000) return 'Check notes and source references.';
  if (!integer(item.revision)) return 'The plan revision must be a whole number.';
  return '';
}

const PALLET_CAPACITY = 36;
function panelGroupAt(plan, ordinal) {
  let end = 0;
  for (const group of plan?.panelGroups || []) {
    if (!Number.isSafeInteger(group.quantity) || group.quantity < 1) continue;
    end += group.quantity;
    if (ordinal <= end) return group;
  }
  return null;
}

export function automaticPalletLayout(left, right) {
  const base = {capacity:PALLET_CAPACITY, totalPanels:null, pallets:[], rows:[], span:0, alignment:'north', error:''};
  if (!left || !right) return {...base,error:'Choose the row on your right to calculate the pallet layout.'};
  if (left.field !== right.field || left.rowNumber === right.rowNumber) return {...base,error:'Choose two different rows in the same field.'};
  if ([left,right].some(row => !integer(row.panelCount) || row.panelCount > 10000)) return {...base,error:'Both rows need a known panel count before pallets can be placed automatically.'};
  const totalPanels = left.panelCount+right.panelCount;
  if (!totalPanels) return {...base,totalPanels:0};
  const motorKnown = row => integer(row.motorAfterPanel) && row.motorAfterPanel >= 1 && row.motorAfterPanel <= row.panelCount;
  const alignment = [left,right].every(motorKnown) ? 'motor' : 'north';
  const motor = alignment==='motor' ? Math.max(left.motorAfterPanel,right.motorAfterPanel) : 0;
  const geometry = [left,right].map(row => {
    const start = alignment==='motor' ? motor-row.motorAfterPanel : 0;
    return {row,start,end:start+row.panelCount};
  });
  const extent = Math.max(...geometry.map(row=>row.end));
  const rows = geometry.map(({row,start,end}) => ({rowNumber:row.rowNumber,offset:start,start:start/extent,end:end/extent,
    motorPosition:motorKnown(row)?(start+row.motorAfterPanel)/extent:null}));
  const edges = [...new Set(geometry.flatMap(row=>[row.start,row.end]))].sort((a,b)=>a-b);
  const segments = edges.slice(0,-1).map((start,i) => ({start,end:edges[i+1],rate:geometry.filter(row=>row.start<=start && row.end>=edges[i+1] && row.end>row.start).length}));
  const count = Math.ceil(totalPanels/PALLET_CAPACITY);
  const pallets = Array.from({length:count},(_,index) => {
    // Equal work intervals along the shifted rows, counting only rows present at each position.
    let demand = (index+.5)*totalPanels/count, coordinate = 0;
    for (const segment of segments) {
      const panels = (segment.end-segment.start)*segment.rate;
      if (!panels) continue;
      if (demand <= panels) {coordinate=segment.start+demand/segment.rate;break;}
      demand -= panels;
    }
    const candidates = geometry.filter(row => coordinate>row.start && coordinate<=row.end).map(({row,start}) => {
      const nearPanel = Math.ceil(coordinate-start);
      return {row,nearPanel,group:panelGroupAt(row,nearPanel)};
    });
    const shared = candidates.length===2 && candidates[0].group?.positiveSide===candidates[1].group?.positiveSide && (candidates[0].group?.typeId || candidates[0].row.panelTypeId)===(candidates[1].group?.typeId || candidates[1].row.panelTypeId);
    const selected = shared ? candidates[0] : candidates[index%candidates.length];
    const positiveSide = ['N','S'].includes(selected.group?.positiveSide) ? selected.group.positiveSide : null;
    const destinations = shared ? candidates : [selected];
    return {number:index+1,panels:PALLET_CAPACITY,position:coordinate/extent,nearPanel:selected.nearPanel,positiveSide,
      labelSide:positiveSide==='N'?'left':positiveSide==='S'?'right':null,
      typeId:selected.group?.typeId || selected.row.panelTypeId,
      forRows:destinations.map(candidate=>candidate.row.rowNumber),
      nearPanels:destinations.map(candidate=>({rowNumber:candidate.row.rowNumber,panel:candidate.nearPanel}))};
  });
  return {...base,totalPanels,pallets,rows,span:extent,alignment};
}


export function createRowPlansFeature(api) {
  const {esc, btn} = api;
  const writable=()=>api.canEdit?api.canEdit():true;
  const editorActions=new Set(['plan-new','plan-edit','plan-type-edit','plan-import','plan-import-apply']);
  let field = '', query = '', teamContext = null, parent = {screen:'settings', id:null};
  let selectedRow = null, selectedType = null, currentScreen = 'rowPlans', tab = 'plan', mode = 'panels';
  let draft = null, editBase = null, typeBase = null, editDirty = false, importText = '', importPreview = null, typeParent='settings';
  let palletNeighborId = null;
  let listMode='list',siteMap=null,visibleRows=60;
  let geometryRows=null,geometryIndex=new Map();
  const mapRecord = plan => {const rows=database().siteMap?.rows;if(rows!==geometryRows){geometryRows=rows;geometryIndex=new Map((Array.isArray(rows)?rows:[]).map(r=>[r.field+'\0'+r.rowNumber,r]));}return geometryIndex.get(plan.field+'\0'+plan.rowNumber);};
  function mapFeature(){
    if(!siteMap&&api.createMap)siteMap=api.createMap({openRow:(id,pallets=false)=>{selectedRow=id;palletNeighborId=null;tab=pallets?'diagram':'plan';mode=pallets?'pallets':'panels';api.navigate('rowPlan');}});
    return siteMap;
  }
  const database = () => api.getDb();
  const plans = () => database().rowPlans || [];
  const types = () => database().panelTypes || [];
  const fields = () => database().fields || [];
  const planById = id => plans().find(p => p.id === id);
  const typeById = id => types().find(t => t.id === id);
  const status = plan => '<span class="tag '+(plan.status === 'verified' ? 'good' : plan.status === 'partial' ? 'neutral' : 'amber')+'">'+(plan.status === 'verified' ? 'Verified' : plan.status === 'partial' ? 'Awaiting information' : 'Needs review')+'</span>';
  const knownText = (known, count, unit) => known && count !== null ? `${count} ${unit}` : count !== null ? `${count} ${unit} · incomplete` : 'Awaiting information';
  const option = (value, label, selected) => '<option value="'+esc(value)+'" '+(value === selected ? 'selected' : '')+'>'+esc(label)+'</option>';
  const selectOptions = (values, selected) => values.map(value => option(value, value, selected)).join('');
  const direction = side => side === 'N' ? '↑ + North' : side === 'S' ? '↓ + South' : '? Not confirmed';
  const renderPage = (title, content) => api.draw(api.header(title, true) + '<div class="plans-feature">'+content+'</div>');
  const typeName = type => type ? `${type.name} · ${type.description || 'Description pending'} · Class ${type.currentClass || '?'}` : 'Panel type not recorded';
  function typeBadge(id, compact = false) {
    const type = typeById(id);
    return '<span class="plan-type-badge'+(compact?' compact-type':'')+'"><span class="plan-swatch" style="background:'+colorValue(type?.color)+'" aria-hidden="true"></span><span><strong>'+esc(type?.name || 'Unknown type')+'</strong>'+(!compact?'<small>'+esc(type?.description || 'Description pending')+' · Current Class '+esc(type?.currentClass || 'pending')+'</small>':'')+'</span></span>';
  }
  function typeOptions(selected) {
    return types().filter(t => t.configured || t.id === selected).map(t => option(t.id, typeName(t)+(t.configured?'':' · awaiting setup'), selected)).join('');
  }
  const compass = '<div class="plan-compass"><strong>N · North</strong><span aria-hidden="true">↓</span><strong>S · South</strong><small>All numbers start at the north end</small></div>';
  function sourceDetails(plan) {
    return '<details class="plan-source"><summary>Source & review notes</summary><dl><dt>Panel source</dt><dd>'+esc(plan.source?.panels || 'Not supplied')+'</dd><dt>Damper source</dt><dd>'+esc(plan.source?.dampers || 'Not supplied')+'</dd></dl>'+(plan.notes?'<p>'+esc(plan.notes)+'</p>':'')+'<small>Plan revision '+esc(plan.revision)+'</small></details>';
  }
  function listRows() {
    const rank=p=>query&&String(p.rowNumber)===query?0:1;
    const rows = plans().filter(p => (!field || p.field === field) && (!query || String(p.rowNumber).includes(query) || (p.rowType || '').toLowerCase().includes(query.toLowerCase()) || mapFeature()?.matches(mapRecord(p)||{},query))).sort((a,b) => rank(a)-rank(b) || fields().indexOf(a.field)-fields().indexOf(b.field) || a.rowNumber-b.rowNumber);
    return rows.length ? '<p class="plan-result-count" role="status">'+rows.length+' '+(rows.length===1?'row':'rows')+(rows.length>visibleRows?' · Showing '+visibleRows:'')+'</p><div class="plan-list">'+rows.slice(0,visibleRows).map(p => '<button type="button" class="card plan-row-card" data-action="plan-row" data-id="'+esc(p.id)+'"><span class="row"><strong>Row '+esc(p.rowNumber)+'</strong>'+status(p)+'</span><small>'+esc(p.field)+(p.rowType?' · Type '+esc(p.rowType):'')+'</small>'+typeBadge(p.panelTypeId)+'<span class="plan-row-counts"><span>Panels<br><strong>'+esc(knownText(p.panelsKnown, p.panelCount, 'panels'))+'</strong></span><span>Dampers<br><strong>'+esc(knownText(p.dampersKnown, p.damperCount, 'dampers'))+'</strong></span></span></button>').join('')+'</div>'+(rows.length>visibleRows?btn('Show more rows','plan-more','secondary'):'') : '<section class="empty"><h2>No row plans found</h2><p>Try a row number, post ID or another field.</p>'+btn('Clear filters','plan-reset','secondary')+'</section>';
  }
  function drawList() {
    if (field && !fields().includes(field)) field = '';
    const context = teamContext ? '<section class="card plan-context"><strong>Team '+esc(teamContext.number)+' · '+esc(teamContext.field)+'</strong><small>'+esc(teamContext.work)+' · '+(present(teamContext.from)?'Start row '+esc(teamContext.from):'No start row')+'</small></section>' : '<p class="rows-subtitle">'+plans().length+' rows · '+esc(fields().join(' / '))+'</p>';
    const views='<div class="plan-tabs" role="group" aria-label="Rows view">'+['list','map'].map(v=>'<button type="button" data-action="plan-list-mode" data-id="'+v+'" class="'+(listMode===v?'active':'')+'" aria-pressed="'+(listMode===v)+'">'+(v==='list'?'List':'Map')+'</button>').join('')+'</div>';
    const tools='<details class="plan-tools"><summary>Row tools</summary><div class="plan-toolbar">'+btn('Add row plan', 'plan-new', 'compact primary')+btn('Panel types', 'plan-types', 'compact')+btn('Import plans', 'plan-import', 'compact')+'</div></details>';
    renderPage('Rows', '<div class="rows-hub">'+context+'<form data-form="plan-filter" class="plan-filters"><div class="plan-search-line"><label><span class="sr-only">Field</span><select name="field">'+option('', 'All fields', field)+selectOptions(fields(), field)+'</select></label><label><span class="sr-only">Find row, type or post ID</span><input name="query" type="search" value="'+esc(query)+'" maxlength="60" placeholder="Row / ID" inputmode="search" enterkeyhint="search"></label><button type="submit" class="compact" aria-label="Find rows">Find</button></div>'+(field||query?'<div class="plan-filter-summary"><small>'+esc(field||'All fields')+(query?' · '+esc(query):'')+'</small>'+btn('Clear','plan-reset','text-button')+'</div>':'')+'</form>'+views+'<div id="plan-results">'+(listMode==='map'?(mapFeature()?.html(field,query)||'<section class="empty">Map is unavailable.</section>'):listRows())+'</div>'+tools+'</div>');
    if(listMode==='map'&&typeof document!=='undefined')mapFeature()?.mount(document.querySelector('.site-map'));
  }
  function drawPlan() {
    const plan = planById(selectedRow);
    if (!plan) { renderPage('Row plan', '<section class="empty"><h2>Row plan is unavailable</h2>'+btn('View row plans', 'plan-list')+'</section>'); return; }
    const mixed=new Set(plan.panelGroups.map(g=>g.typeId)).size>1;
    const active=tab==='plan'?'instructions':mode;
    const tabs = '<div class="plan-tabs plan-section-tabs" role="group" aria-label="Plan view">'+[['instructions','Instructions'],['panels','Panels'],['dampers','Dampers'],['pallets','Pallets']].map(([v,label]) => '<button type="button" class="'+(active===v?'active':'')+'" data-action="plan-section" data-id="'+v+'" aria-pressed="'+(active===v)+'">'+label+'</button>').join('')+'</div>';
    renderPage('Row '+plan.rowNumber, '<section class="card plan-overview"><div class="row"><p class="eyebrow">'+esc(plan.field)+(plan.rowType?' · Row type '+esc(plan.rowType):'')+'</p>'+status(plan)+'</div>'+typeBadge(plan.panelTypeId)+(mixed?'<small class="warning-text">Mixed panel types · Check each group</small>':'')+'<div class="plan-summary"><span><small>Panels</small><strong>'+esc(knownText(plan.panelsKnown, plan.panelCount, 'panels'))+'</strong></span><span><small>Dampers</small><strong>'+esc(knownText(plan.dampersKnown, plan.damperCount, 'dampers'))+'</strong></span><span><small>Motor · panel</small><strong>'+(plan.motorAfterPanel===null?'Not supplied':'After '+esc(plan.motorAfterPanel))+'</strong></span></div>'+(mapRecord(plan)?btn('Show on map','plan-show-map','compact plan-map-link',plan.id):'')+'</section>'+tabs+(tab==='diagram'?diagram(plan):planDetails(plan))+sourceDetails(plan)+btn('Edit installation plan', 'plan-edit', 'secondary', plan.id));
  }
  function planDetails(plan) {
    const geometry=mapRecord(plan);
    let ordinal = 1;
    const references=[];
    const groups = plan.panelGroups.map((group,index) => {const first=ordinal;ordinal+=group.quantity;const sourceGroup=geometry?.groups?.find(g=>g.first===first&&g.last===ordinal-1);references.push('<li><strong>Group '+(index+1)+' · Panels '+first+'–'+(ordinal-1)+'</strong>'+(sourceGroup?'<small>String ID '+esc(sourceGroup.id)+'</small>':'')+typeBadge(group.typeId)+(group.sourceToken?'<small>Original marking: '+esc(group.sourceToken)+'</small>':'')+'</li>');return '<li><div class="row"><strong>Group '+(index+1)+' · Panels '+first+'–'+(ordinal-1)+'</strong><span class="plan-direction '+(group.positiveSide?'':'warning-text')+'">'+direction(group.positiveSide)+'</span></div><div class="plan-group-meta">'+typeBadge(group.typeId,true)+'<small>'+group.quantity+' panels</small></div>'+(sourceGroup?.crossesDrive?'<small class="plan-drive-note">Crosses the drive gap · 21 north + 4 south</small>':'')+'</li>'}).join('');
    const dampers = [...plan.dampers].sort((a,b) => a.post-b.post || a.side.localeCompare(b.side)).map(d => {const post=geometry?.posts?.find(p=>p.post===d.post&&p.side===d.side);return '<li class="row"><span><strong>Post '+esc(d.post)+'</strong>'+(post?'<small>Pile ID '+esc(post.id)+'</small>':'')+'</span><span>'+ (d.side==='E'?'East →':'← West')+'</span></li>'}).join('');
    return '<section class="card"><h2>Panel sequence · North → South</h2>'+(!plan.panelsKnown?'<p class="plan-notice">Panel instructions are incomplete. Confirm the source before installation.</p>':'')+(groups?'<ol class="plan-detail-list">'+groups+'</ol><details class="plan-technical"><summary>Panel IDs & markings</summary><ol class="plan-detail-list">'+references.join('')+'</ol></details>':'<p class="muted">Panel group information has not been supplied.</p>')+'</section><section class="card"><h2>Damper positions</h2><p class="hint">Post numbers start at the north end. Panel numbers and post numbers are separate.</p>'+(!plan.dampersKnown?'<p class="plan-notice">Damper instructions have not been confirmed.</p>':'')+(dampers?'<ul class="plan-detail-list">'+dampers+'</ul>':'<p class="muted">'+(plan.dampersKnown?'No dampers required.':'No damper positions supplied.')+'</p>')+'</section><section class="card"><h2>Additional instructions</h2><dl class="plan-facts"><dt>Slope</dt><dd>'+ (plan.slope===null?'Not supplied':esc(plan.slope)+'°')+'</dd><dt>Lower bearing side</dt><dd>'+esc(plan.lowerBearingSide || 'Not supplied')+'</dd><dt>Motor</dt><dd>'+ (plan.motorAfterPanel===null?'Position not supplied':'After panel '+esc(plan.motorAfterPanel))+(geometry?.motor?'<small>Post '+esc(geometry.motor.post)+' · Pile ID '+esc(geometry.motor.id)+'</small>':'')+'</dd></dl></section>'+palletDetails(plan);
  }
  function palletNeighbor(plan) {
    const candidates = plans().filter(row => row.field===plan.field && row.rowNumber!==plan.rowNumber && row.id!==plan.id);
    return candidates.find(row => row.id===palletNeighborId) || (palletNeighborId===null && candidates.find(row => row.rowNumber===plan.rowNumber+1)) || null;
  }
  function palletPairControls(plan) {
    const neighbor = palletNeighbor(plan);
    const candidates = plans().filter(row => row.field===plan.field && row.rowNumber!==plan.rowNumber && row.id!==plan.id).sort((a,b)=>a.rowNumber-b.rowNumber);
    return '<div class="grid2 plan-pallet-pair"><div><small>Row on your left</small><strong>Row '+esc(plan.rowNumber ?? 'not set')+'</strong><small>'+esc(plan.panelCount===null?'Panel count not supplied':plan.panelCount+' panels')+'</small></div><label>Row on your right<select name="palletNeighborId" data-pallet-neighbor>'+option('','Choose row',neighbor?.id || '')+candidates.map(row=>option(row.id,'Row '+row.rowNumber+' · '+(row.panelCount===null?'count pending':row.panelCount+' panels'),neighbor?.id || '')).join('')+'</select></label></div>';
  }
  function automaticPalletSummary(plan) {
    const neighbor = palletNeighbor(plan), layout = automaticPalletLayout(plan,neighbor);
    if (layout.error) return '<p class="plan-notice">'+esc(layout.error)+'</p>';
    const count = layout.pallets.length;
    return '<div class="plan-pallet-total"><strong>'+count+' '+(count===1?'pallet':'pallets')+'</strong><span>'+esc(plan.panelCount)+' + '+esc(neighbor.panelCount)+' = '+layout.totalPanels+' panels</span><small>36 panels per pallet · Rounded up for this pair</small></div><p class="hint">Left/right are the two rows beside the aisle. Carryover is not tracked.</p>';
  }
  function palletDetails(plan) {
    return '<section class="card plan-pallet-section"><h2>Automatic pallet placement</h2>'+palletPairControls(plan)+automaticPalletSummary(plan)+btn('View pallet layout','plan-pallets','secondary')+'</section>';
  }
  function palletConstructorPreview(plan) {
    return palletPairControls(plan)+automaticPalletSummary(plan)+'<details class="plan-pallet-preview-details"><summary>Preview placement</summary>'+automaticPalletDiagram(plan)+'</details>';
  }

  function diagram(plan) {
    const content = mode==='panels'?panelDiagram(plan):mode==='dampers'?damperDiagram(plan):palletDiagram(plan);
    return '<section class="card plan-diagram">'+compass+content+'<p class="hint">Schematic only. Distances are not to scale. Panel ordinals and post ordinals are independent.</p></section>';
  }
  function svgStart(title, height = 660) {
    return '<svg class="plan-svg" viewBox="0 0 360 '+height+'" role="img" aria-label="'+esc(title)+'" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="plan-panel-lines" width="74" height="9" patternUnits="userSpaceOnUse"><rect width="74" height="9" fill="#183b5c"/><path d="M0 8.5h74M37 0v9" stroke="#5b7993" stroke-width=".6"/></pattern></defs>';
  }
  function panelDiagram(plan) {
    const sum = plan.panelGroups.reduce((value,g) => value+g.quantity,0), total = plan.panelCount || sum;
    if (!total || !plan.panelGroups.length) return '<div class="plan-no-diagram"><strong>Panel layout is awaiting information</strong><p>Add panel groups, quantities and directions in the constructor.</p></div>';
    let index=0, svg=svgStart('Panel groups for row '+plan.rowNumber+', numbered north to south');
    svg += '<text x="150" y="26" text-anchor="middle" class="svg-title">Row '+esc(plan.rowNumber)+'</text><rect x="110" y="46" width="80" height="548" rx="4" fill="#e9eef3" stroke="#8b9cae"/>';
    plan.panelGroups.forEach((group,i) => {const y=46+index/total*548,height=group.quantity/total*548,type=typeById(group.typeId),first=index+1;index+=group.quantity;svg+='<rect x="113" y="'+y+'" width="74" height="'+height+'" fill="url(#plan-panel-lines)"/><rect x="110" y="'+y+'" width="5" height="'+height+'" fill="'+colorValue(type?.color)+'"/><path d="M96 '+y+'H194" stroke="#7b93a6" stroke-dasharray="3 3"/><text x="98" y="'+(y+Math.min(18,height/2))+'" text-anchor="end" class="svg-label">'+first+'–'+index+'</text><text x="205" y="'+(y+Math.min(18,height/2))+'" class="svg-direction">'+esc(direction(group.positiveSide))+'</text><text x="205" y="'+(y+Math.min(34,height*.75))+'" class="svg-small">Group '+(i+1)+' · '+group.quantity+'</text>'});
    if (sum < total) svg+='<text x="204" y="'+(46+sum/total*548+22)+'" class="svg-small">'+(total-sum)+' panels: no groups</text>';
    if (plan.motorAfterPanel !== null) {const y=46+plan.motorAfterPanel/total*548;svg+='<path d="M102 '+y+'H198" stroke="#ae3042" stroke-width="3"/><circle cx="150" cy="'+y+'" r="6" fill="#fff" stroke="#ae3042" stroke-width="3"/><text x="16" y="'+Math.min(623,y+22)+'" class="svg-motor">Motor after panel '+plan.motorAfterPanel+'</text>'}
    svg+='<text x="150" y="623" text-anchor="middle" class="svg-small">'+total+' panel positions · North → South</text></svg>';
    return (!plan.panelsKnown?'<p class="plan-notice">Incomplete panel instructions</p>':'')+svg+'<div class="plan-diagram-legend">'+plan.panelGroups.map((g,i)=>'<div><strong>Group '+(i+1)+'</strong>'+typeBadge(g.typeId)+'</div>').join('')+'</div>'+(plan.motorAfterPanel===null?'<p class="hint">Motor position has not been supplied.</p>':'');
  }
  function damperDiagram(plan) {
    if (!plan.dampers.length) return '<div class="plan-no-diagram"><strong>'+(plan.dampersKnown?'No dampers required':'Damper layout is awaiting information')+'</strong><p>Set the post number and East/West side for each damper in the constructor.</p></div>';
    const posts = [...new Set(plan.dampers.map(d => d.post))].sort((a,b)=>a-b), height=Math.max(370,130+posts.length*95), spacing=(height-150)/Math.max(posts.length-1,1);
    let svg=svgStart('Damper positions for row '+plan.rowNumber+'; post numbers from north',height);
    svg+='<text x="40" y="28" class="svg-title">West</text><text x="273" y="28" class="svg-title">East</text><path d="M180 58V'+(height-50)+'" stroke="#8c9bab" stroke-width="9"/>';
    posts.forEach((post,i) => {const y=80+i*spacing;svg+='<circle cx="180" cy="'+y+'" r="16" fill="#fff" stroke="#657b90" stroke-width="2"/><text x="180" y="'+(y+5)+'" text-anchor="middle" class="svg-label">'+post+'</text>';plan.dampers.filter(d=>d.post===post).forEach(d=>{const east=d.side==='E',x=east?242:73;svg+='<path d="M'+(east?199:161)+' '+y+'H'+(east?257:102)+'" stroke="#00875b" stroke-width="6"/><rect x="'+x+'" y="'+(y-21)+'" width="45" height="42" rx="6" fill="#e0f6eb" stroke="#00875b" stroke-width="2"/><text x="'+(x+22)+'" y="'+(y+5)+'" text-anchor="middle" class="svg-label">'+d.side+'</text>'})});
    return (!plan.dampersKnown?'<p class="plan-notice">Incomplete damper instructions</p>':'')+svg+'<text x="180" y="'+(height-18)+'" text-anchor="middle" class="svg-small">Post numbers from north · '+plan.dampers.length+' dampers</text></svg><p class="hint">Only recorded posts are shown. Gaps between posts are schematic.</p>';
  }
  function automaticPalletDiagram(plan) {
    const neighbor = palletNeighbor(plan), layout = automaticPalletLayout(plan,neighbor);
    if (layout.error) return '<div class="plan-no-diagram"><strong>Automatic pallet layout is awaiting row information</strong><p>'+esc(layout.error)+'</p></div>';
    if (!layout.pallets.length) return '<div class="plan-no-diagram"><strong>No pallets needed</strong><p>Both rows have zero panels.</p></div>';
    const total = layout.span, height = Math.max(680,layout.pallets.length*110+140), start = 65, length = height-145;
    let svg = svgStart('Automatic pallet placement between rows '+plan.rowNumber+' and '+neighbor.rowNumber,height);
    const rowDrawing = (row,x,geometry) => {
      const rowStart = start+geometry.start*length;
      const rowLength = row.panelCount/total*length;
      let drawing = '<text x="'+(x+30)+'" y="25" text-anchor="middle" class="svg-title">Row '+esc(row.rowNumber)+'</text><text x="'+(x+30)+'" y="46" text-anchor="middle" class="svg-small">'+row.panelCount+' panels</text><rect class="svg-pallet-row" data-row-number="'+esc(row.rowNumber)+'" x="'+x+'" y="'+rowStart+'" width="60" height="'+rowLength+'" fill="url(#plan-panel-lines)"/>';
      let ordinal = 0;
      for (const group of row.panelGroups) {
        const span = Math.min(group.quantity,Math.max(0,row.panelCount-ordinal));
        if (!span) break;
        const y = rowStart+ordinal/total*length, groupHeight = span/total*length;
        drawing += '<rect x="'+x+'" y="'+y+'" width="5" height="'+groupHeight+'" fill="'+colorValue(typeById(group.typeId)?.color)+'"/><text x="'+(x+30)+'" y="'+(y+groupHeight/2+4)+'" text-anchor="middle" class="svg-pallet-row-direction">'+(group.positiveSide==='N'?'↑ + N':group.positiveSide==='S'?'↓ + S':'? +')+'</text>';
        ordinal += span;
      }
      if (geometry.motorPosition !== null) {
        const y = start+geometry.motorPosition*length;
        drawing += '<path d="M'+(x-3)+' '+y+'H'+(x+63)+'" stroke="#ae3042" class="svg-pallet-motor" data-row-number="'+esc(row.rowNumber)+'" stroke-width="3"/>';
      }
      return drawing+'<text x="'+(x+30)+'" y="'+(rowStart+rowLength+23)+'" text-anchor="middle" class="svg-small">Panel '+row.panelCount+'</text>';
    };
    svg += rowDrawing(plan,44,layout.rows[0])+rowDrawing(neighbor,256,layout.rows[1]);
    for (const pallet of layout.pallets) {
      const y = start+pallet.position*length, north = pallet.positiveSide==='N', south = pallet.positiveSide==='S', colour = colorValue(typeById(pallet.typeId)?.color);
      const labelX = north ? 145 : 204, labelY = north ? y-23 : y+4;
      svg += '<g class="svg-auto-pallet" data-label-side="'+esc(pallet.labelSide || 'unknown')+'" data-positive-side="'+esc(pallet.positiveSide || 'unknown')+'"><title>Pallet '+pallet.number+' · '+esc(pallet.forRows.join(' / '))+' · '+esc(direction(pallet.positiveSide))+' · '+(pallet.labelSide?'Label '+pallet.labelSide+' on screen':'Label direction not confirmed')+'</title><path d="M108 '+y+'H252" stroke="#9babb9" stroke-dasharray="3 4"/><rect x="141" y="'+(y-20)+'" width="78" height="43" rx="3" fill="#9a7548"/><rect x="145" y="'+(y-23)+'" width="70" height="37" rx="2" fill="#214969" stroke="#92abc0"/>';
      if (pallet.labelSide) svg += '<rect class="svg-pallet-label" x="'+labelX+'" y="'+labelY+'" width="11" height="10" fill="'+colour+'" stroke="#fff" stroke-width=".8"/>';
      
      const panelLabel = pallet.nearPanels.length===2 && pallet.nearPanels[0].panel!==pallet.nearPanels[1].panel ? 'Panels '+pallet.nearPanels.map(p=>p.panel).join(' / ') : 'Near panel '+pallet.nearPanel;
      svg += '<text x="180" y="'+(y+2)+'" text-anchor="middle" class="svg-pallet-row-direction">'+pallet.number+'</text><text x="180" y="'+(y+38)+'" text-anchor="middle" class="svg-label">'+(north?'↑ + N':south?'↓ + S':'? Plus unknown')+'</text><text x="180" y="'+(y+53)+'" text-anchor="middle" class="svg-small">'+panelLabel+' · 36 panels</text>';
      if (pallet.forRows.length===1) svg += '<text x="180" y="'+(y+68)+'" text-anchor="middle" class="svg-small">For row '+esc(pallet.forRows[0])+'</text>';
      svg += '</g>';
    }
    svg += '<text x="74" y="'+(height-20)+'" text-anchor="middle" class="svg-title">Left</text><text x="286" y="'+(height-20)+'" text-anchor="middle" class="svg-title">Right</text></svg>';
    const uncertain = layout.pallets.some(pallet=>!pallet.labelSide) ? '<p class="plan-notice">Some positive directions are not confirmed. Their label side is shown as unknown.</p>' : '';
    const alignmentNote = layout.alignment==='motor' ? 'Rows align at their motors. Paired panel numbers are left / right, counted from each row\'s north end.' : 'Motor positions are not confirmed for both rows. North ends are shown together; the row offset is unconfirmed.';
    return svg+'<p class="hint">'+alignmentNote+'</p><p class="plan-pallet-label-key"><span class="plan-pallet-key-label" aria-hidden="true"></span>Label: left when facing the positive connector.</p><p class="hint">+ North → label on the left. + South → label on the right. Pallet colour follows the panel type.</p>'+uncertain;
  }
  function palletDiagram(plan) {
    return palletPairControls(plan)+automaticPalletSummary(plan)+automaticPalletDiagram(plan);
  }

  function blankPlan() {
    return {id:api.newId(), field:field || fields()[0] || '', rowNumber:present(teamContext?.from)?Number(teamContext.from):null, rowType:'', panelTypeId:types().find(t=>t.configured)?.id || 'yellow', panelCount:null, panelsKnown:false, panelGroups:[], dampersKnown:false, damperCount:null, dampers:[], slope:null, lowerBearingSide:null, motorAfterPanel:null, pallets:[], status:'needs_review', notes:'', source:{panels:'',dampers:''}, revision:0};
  }
  function startEdit(id) {
    if (!id) palletNeighborId=null;
    editBase = id ? copy(planById(id)) : null;
    if (id && !editBase) {api.toast('This row plan is no longer available.');return;}
    selectedRow = id || null;
    draft = editBase ? copy(editBase) : blankPlan(); editDirty=false;
    api.navigate('rowPlanEdit');
  }
  function input(name, value, extra = '') {return '<input name="'+esc(name)+'" value="'+esc(value)+'" '+extra+'>';}
  function drawEdit() {
    if (!draft) draft=blankPlan();
    const groupInputs=draft.panelGroups.map((g,i)=>'<fieldset class="plan-item"><legend>Group '+(i+1)+' · North → South</legend><div class="grid2"><label>Panel quantity'+input('groupQuantity_'+i,g.quantity,'type="number" min="1" max="10000" step="1" inputmode="numeric" required')+'</label><label>Positive connector<select name="groupSide_'+i+'">'+option('', 'Not confirmed',g.positiveSide || '')+option('N','↑ + North',g.positiveSide)+option('S','↓ + South',g.positiveSide)+'</select></label></div><label>Panel type<select name="groupType_'+i+'">'+typeOptions(g.typeId)+'</select></label><label>Original source marking <span class="optional">Optional</span>'+input('groupToken_'+i,g.sourceToken,'maxlength="160" placeholder="For example 650H"')+'</label>'+btn('Remove group','plan-remove-group','text-button',String(i))+'</fieldset>').join('');
    const damperInputs=draft.dampers.map((d,i)=>'<fieldset class="plan-item"><legend>Damper '+(i+1)+'</legend><div class="grid2"><label>Post from north'+input('damperPost_'+i,d.post,'type="number" min="1" max="2147483647" step="1" inputmode="numeric" required')+'</label><label>Side<select name="damperSide_'+i+'">'+option('E','East',d.side)+option('W','West',d.side)+'</select></label></div>'+btn('Remove damper','plan-remove-damper','text-button',String(i))+'</fieldset>').join('');
    const palletInputs=draft.pallets.map((p,i)=>'<fieldset class="plan-item"><legend>Pallet '+(i+1)+'</legend><div class="grid2"><label>Panels on pallet'+input('palletPanels_'+i,p.panels,'type="number" min="1" max="10000" step="1" required')+'</label><label>After panel number'+input('palletAfter_'+i,p.afterPanel,'type="number" min="1" max="10000" step="1" required')+'</label></div><label>Adjacent row number'+input('palletRow_'+i,p.adjacentRow,'type="number" min="0" max="2147483647" step="1" required')+'</label>'+btn('Remove pallet','plan-remove-pallet','text-button',String(i))+'</fieldset>').join('');
    renderPage(editBase?'Edit row '+editBase.rowNumber:'Add row plan', '<p class="hint">Constructor · All positions count from North → South. Leave unsupplied values blank.</p><form data-form="plan-save"><section class="card"><h2>Row identity</h2><div class="grid2"><label>Field<select name="field" required>'+selectOptions(fields(),draft.field)+'</select></label><label>Row number'+input('rowNumber',draft.rowNumber,'type="number" min="0" max="2147483647" step="1" required')+'</label></div><label>Row type <span class="optional">Optional</span>'+input('rowType',draft.rowType,'maxlength="40" placeholder="A, B, C…"')+'</label><label>Default panel type<select name="panelTypeId" required>'+typeOptions(draft.panelTypeId)+'</select></label><p class="hint">Type identity is Description + Current Class. Colour is its visual marker. Each group can have its own type.</p></section><section class="card"><h2>Panels · North → South</h2><label>Total panels'+input('panelCount',draft.panelCount,'type="number" min="0" max="10000" step="1" placeholder="Not supplied"')+'</label><label class="check-line"><input name="panelsKnown" type="checkbox" '+(draft.panelsKnown?'checked':'')+'> Panel count and groups are fully supplied</label>'+groupInputs+btn('Add panel group','plan-add-group','secondary')+'<p class="hint">Groups follow installation order from the north end. Their quantities must add up to the total when the instructions are complete.</p></section><section class="card"><h2>Dampers</h2><label>Total dampers'+input('damperCount',draft.damperCount,'type="number" min="0" max="100" step="1" placeholder="Not supplied"')+'</label><label class="check-line"><input name="dampersKnown" type="checkbox" '+(draft.dampersKnown?'checked':'')+'> Damper instructions are fully supplied</label><p class="hint">Post numbers start at the north end. They are separate from panel numbers.</p>'+damperInputs+btn('Add damper','plan-add-damper','secondary')+'</section><section class="card"><h2>Additional instructions</h2><div class="grid2"><label>Slope (degrees)'+input('slope',draft.slope,'type="number" min="-90" max="90" step="any" placeholder="Not supplied"')+'</label><label>Lower bearing side'+input('lowerBearingSide',draft.lowerBearingSide,'maxlength="80" placeholder="Not supplied"')+'</label></div><label>Motor after panel number'+input('motorAfterPanel',draft.motorAfterPanel,'type="number" min="1" max="10000" step="1" placeholder="Position not supplied"')+'</label></section><section class="card plan-pallet-constructor"><h2>Automatic pallet placement</h2><p class="hint">The forklift layout is calculated from both row counts. No carryover is tracked.</p><div id="plan-pallet-preview">'+palletConstructorPreview(draft)+'</div>'+(draft.pallets.length?'<details><summary>Existing manual positions</summary>'+palletInputs+'<p class="hint">These saved positions are retained separately. The automatic forklift layout uses both row counts.</p></details>':'')+'</section><section class="card"><h2>Review & source</h2><label>Status<select name="status">'+option('needs_review','Needs review',draft.status)+option('partial','Awaiting information',draft.status)+option('verified','Verified',draft.status)+'</select></label><label>Panel source'+input('panelSource',draft.source.panels,'maxlength="1000"')+'</label><label>Damper source'+input('damperSource',draft.source.dampers,'maxlength="1000"')+'</label><label>Notes<textarea name="notes" maxlength="5000">'+esc(draft.notes)+'</textarea></label></section><button type="submit" class="primary">Save installation plan</button>'+btn('Cancel','back')+'</form>');
    if (editDirty) api.markDirty();
  }
  function readDraft(form) {
    const value=name=>String(form.get(name) || '').trim();
    return {...draft, field:value('field'), rowNumber:numberValue(form.get('rowNumber')), rowType:value('rowType'), panelTypeId:value('panelTypeId'), panelCount:numberValue(form.get('panelCount')), panelsKnown:form.has('panelsKnown'), panelGroups:draft.panelGroups.map((g,i)=>({quantity:numberValue(form.get('groupQuantity_'+i)),positiveSide:value('groupSide_'+i)||null,typeId:value('groupType_'+i),sourceToken:value('groupToken_'+i)})), damperCount:numberValue(form.get('damperCount')), dampersKnown:form.has('dampersKnown'), dampers:draft.dampers.map((d,i)=>({post:numberValue(form.get('damperPost_'+i)),side:value('damperSide_'+i)})), slope:numberValue(form.get('slope')), lowerBearingSide:value('lowerBearingSide') || null, motorAfterPanel:numberValue(form.get('motorAfterPanel')), pallets:draft.pallets.map((p,i)=>({panels:numberValue(form.get('palletPanels_'+i)),afterPanel:numberValue(form.get('palletAfter_'+i)),adjacentRow:numberValue(form.get('palletRow_'+i))})), status:value('status'), notes:value('notes'), source:{panels:value('panelSource'),dampers:value('damperSource')}};
  }
  function captureDraft() {
    const form=typeof document !== 'undefined' && document.querySelector('form[data-form="plan-save"]');
    if (form) draft=readDraft(new FormData(form));
  }
  function drawTypes() {
    renderPage('Panel types','<p class="muted">Seven colour-coded types. Description + Current Class identifies the type used in each row.</p><div class="plan-type-list">'+types().map((t,i)=>'<'+(writable()?'button type="button" data-action="plan-type-edit" data-id="'+esc(t.id)+'"':'section')+' class="card plan-type-card"><span class="row"><strong>Type '+(i+1)+'</strong><span class="tag '+(t.configured?'good':'neutral')+'">'+(t.configured?'Ready':'Awaiting details')+'</span></span>'+typeBadge(t.id)+'<small>'+(writable()?'Edit colour, Description and Current Class':'Description + Current Class')+'</small></'+(writable()?'button':'section')+'>').join('')+'</div><p class="hint">Unconfigured types are unavailable for new selections. Existing source references are preserved for review.</p>');
  }
  function drawTypeEdit() {
    const t=typeBase;
    if (!t) {renderPage('Panel type','<section class="empty">Choose a type from the directory.</section>');return;}
    const used=plans().filter(p=>p.panelTypeId===t.id || p.panelGroups.some(g=>g.typeId===t.id)).length;
    renderPage('Edit '+t.name,'<form data-form="plan-type-save"><section class="card">'+typeBadge(t.id)+'<label>Name'+input('name',t.name,'maxlength="120" required')+'</label><label>Colour (hex)'+input('color',t.color,'maxlength="7" pattern="#[0-9a-fA-F]{6}" placeholder="#f3cf35"')+'</label><label>Description'+input('description',t.description,'maxlength="160" placeholder="Full marking from the source table"')+'</label><label>Current Class'+input('currentClass',t.currentClass,'maxlength="32" placeholder="For example H or M"')+'</label><label class="check-line"><input name="configured" type="checkbox" '+(t.configured?'checked':'')+'> Ready to use</label><p class="hint">Ready types require every field. Current Class is a separate field from Description.</p>'+(used?'<p class="plan-notice">This type is referenced by '+used+' row plans. Changes update the shared label in those plans.</p>':'')+'</section><button type="submit" class="primary">Save panel type</button>'+btn('Cancel','back')+'</form>');
  }
  function drawImport() {
    const preview=importPreview;
    renderPage('Import row plans','<p class="muted">Paste prepared JSON. Preview every change before applying it to the shared workspace.</p><form data-form="plan-import-preview"><section class="card"><label>Plans JSON<textarea name="json" class="plan-json" required spellcheck="false" placeholder="{&quot;plans&quot;: [{…}]}">'+esc(importText)+'</textarea></label><p class="hint">Use an array of full row plans, or an object with a plans array. Missing instructions must use null values, empty arrays and Needs review; they are never inferred.</p>'+btn('Show format','plan-import-format','text-button')+'<button type="submit" class="secondary">Preview import</button></section></form>'+(preview?'<section class="card"><h2>Review '+preview.items.length+' row plans</h2><p>'+preview.newCount+' new · '+(preview.items.length-preview.newCount)+' updates</p><p class="plan-notice">Applying replaces each listed plan with its previewed values. Other rows remain unchanged.</p><div class="plan-import-list">'+preview.items.map(p=>'<div class="plan-import-item"><strong>'+esc(p.field)+' · Row '+p.rowNumber+'</strong><small>'+esc(knownText(p.panelsKnown,p.panelCount,'panels'))+' · '+esc(knownText(p.dampersKnown,p.damperCount,'dampers'))+'</small>'+typeBadge(p.panelTypeId)+status(p)+'</div>').join('')+'</div>'+btn('Apply reviewed import','plan-import-apply','primary')+'</section>':'')+'<details id="plan-import-format"><summary>JSON format example</summary><pre class="plan-json-example">'+esc(JSON.stringify({...blankPlan(),id:'South-100',field:'South',rowNumber:100},null,2))+'</pre><p class="hint">Example only. Replace the row number and data with your source. Use N/S for positiveSide, E/W for damper side. panelTypeId and each group’s typeId reference the panel type directory.</p></details>');
  }
  function previewImport(text) {
    if (text.length > 3*1024*1024) throw new Error('The import is too large. Use files smaller than 3 MB.');
    let json;
    try {json=JSON.parse(text);} catch {throw new Error('The JSON could not be read. Check its syntax before previewing.');}
    const items=Array.isArray(json)?json:json?.plans;
    if (!Array.isArray(items) || !items.length || items.length > 2000) throw new Error('Supply between 1 and 2000 full row plans.');
    const ids=new Set(), positions=new Set(), revisions={};let newCount=0;
    for (const item of items) {
      const error=validateRowPlan(item,fields(),types());if(error)throw new Error('Row '+(item?.rowNumber??'?')+': '+error);
      const position=item.field+'\u0000'+item.rowNumber;
      if (ids.has(item.id) || positions.has(position)) throw new Error('The import repeats an ID or field + row number.');
      ids.add(item.id);positions.add(position);
      const existing=planById(item.id), duplicate=plans().find(p=>p.field===item.field && p.rowNumber===item.rowNumber && p.id!==item.id);
      if (duplicate) throw new Error(item.field+' row '+item.rowNumber+' already has ID '+duplicate.id+'. Use that ID to update it.');
      if (existing && (existing.field!==item.field || existing.rowNumber!==item.rowNumber)) throw new Error('ID '+item.id+' belongs to a different row. Keep the original field and row number.');
      revisions[item.id]=existing?.revision??null;if(!existing)newCount++;
    }
    return {items:copy(items),revisions,newCount};
  }
  function handleInput(el) {
    if (el.dataset?.palletNeighbor !== undefined) {
      if (currentScreen==='rowPlanEdit') captureDraft();
      palletNeighborId = el.value;
      if (currentScreen==='rowPlanEdit') {
        const preview = typeof document!=='undefined' && document.querySelector('#plan-pallet-preview');
        if (preview) preview.innerHTML=palletConstructorPreview(draft);
      } else if (currentScreen==='rowPlan') render('rowPlan');
      return true;
    }
    if (currentScreen!=='rowPlanEdit' || !draft || !/^(field|rowNumber|panelCount|panelTypeId|motorAfterPanel|groupQuantity_\d+|groupSide_\d+|groupType_\d+)$/.test(el.name || '')) return false;
    const form=el.closest?.('form[data-form="plan-save"]');
    if (!form) return false;
    draft=readDraft(new FormData(form));editDirty=true;api.markDirty();
    if (el.name==='field' || el.name==='rowNumber') palletNeighborId=null;
    const preview=typeof document!=='undefined' && document.querySelector('#plan-pallet-preview');
    if (preview) preview.innerHTML=palletConstructorPreview(draft);
    return true;
  }
  function render(screen) {
    currentScreen=screen;
    if(screen!=='rowPlans'||listMode!=='map')siteMap?.hide();
    if(!writable()&&['rowPlanEdit','panelTypeEdit','rowPlanImport'].includes(screen)){renderPage('Viewing only','<section class="card"><p>This account has read-only access.</p></section>');return;}
    ({rowPlans:drawList,rowPlan:drawPlan,rowPlanEdit:drawEdit,panelTypes:drawTypes,panelTypeEdit:drawTypeEdit,rowPlanImport:drawImport}[screen] || drawList)();
  }
  async function handleAction(action,id) {
    if (!action.startsWith('plan-')) return false;
    if(!writable()&&(editorActions.has(action)||/^plan-(add|remove)-/.test(action))){api.feedback('This account has read-only access.');return true;}
    if (action==='plan-open') {teamContext=null;parent={screen:'settings',id:null};field='';query='';api.navigate('rowPlans');}
    else if (action==='plan-hub') {teamContext=null;parent={screen:'today',id:null};api.navigate('rowPlans');}
    else if (action==='plan-more') {const previous=visibleRows;visibleRows+=60;render('rowPlans');if(typeof document!=='undefined')document.querySelectorAll('.plan-row-card')[previous]?.focus({preventScroll:true});}
    else if (action==='plan-reset') {field='';query='';visibleRows=60;render('rowPlans');}
    else if (action==='plan-list-mode') {if(['list','map'].includes(id))listMode=id;render('rowPlans');}
    else if (action==='plan-show-map') {const plan=planById(id);if(plan){field=plan.field;query='';listMode='map';mapFeature()?.selectRow(mapRecord(plan));api.navigate('rowPlans');}}
    else if (action==='plan-list') api.navigate('rowPlans');
    else if (action==='plan-row') {selectedRow=id;palletNeighborId=null;tab='plan';mode='panels';api.navigate('rowPlan');}
    else if (action==='plan-new') startEdit(null);
    else if (action==='plan-edit') {selectedRow=id || selectedRow;startEdit(selectedRow);}
    else if (action==='plan-types') {if(id==='settings'){teamContext=null;parent={screen:'settings',id:null};typeParent='settings';}else typeParent='rowPlans';selectedType=null;api.navigate('panelTypes');}
    else if (action==='plan-type-edit') {selectedType=id;typeBase=copy(typeById(id));api.navigate('panelTypeEdit');}
    else if (action==='plan-import') {importPreview=null;importText='';api.navigate('rowPlanImport');}
    else if (action==='plan-tab') {if(['plan','diagram'].includes(id))tab=id;render('rowPlan');}
    else if (action==='plan-section') {const scroll=globalThis.window?.scrollY||0;if(id==='instructions')tab='plan';else if(['panels','dampers','pallets'].includes(id)){tab='diagram';mode=id;}render('rowPlan');if(typeof document!=='undefined'){const tabs=document.querySelector('.plan-section-tabs');if(scroll>240)tabs?.scrollIntoView({block:'start'});tabs?.querySelector('[aria-pressed="true"]')?.focus({preventScroll:true});}}
    else if (action==='plan-pallets') {tab='diagram';mode='pallets';render('rowPlan');}
    else if (action==='plan-mode') {if(['panels','dampers','pallets'].includes(id))mode=id;render('rowPlan');}
    else if (/^plan-(add|remove)-(group|damper|pallet)$/.test(action)) {
      if (!draft || currentScreen!=='rowPlanEdit') return true;
      captureDraft();const match=action.match(/^plan-(add|remove)-(group|damper|pallet)$/), key={group:'panelGroups',damper:'dampers',pallet:'pallets'}[match[2]],index=Number(id);
      if (match[1]==='add') {if(draft[key].length>=100){api.feedback('Use up to 100 items per section.');return true;}draft[key].push(match[2]==='group'?{quantity:25,positiveSide:null,typeId:draft.panelTypeId,sourceToken:''}:match[2]==='damper'?{post:null,side:'E'}:{panels:null,afterPanel:null,adjacentRow:null});}
      else if(Number.isSafeInteger(index)&&index>=0&&index<draft[key].length) draft[key].splice(index,1);
      editDirty=true;render('rowPlanEdit');
    }
    else if (action==='plan-import-format') {const details=document.querySelector('#plan-import-format');if(details){details.open=true;details.scrollIntoView({block:'center'});}}
    else if (action==='plan-import-apply') {
      if(!importPreview){api.feedback('Preview the import first.');return true;}
      if(!api.confirm('Apply '+importPreview.items.length+' reviewed row plans to the shared workspace?')) return true;
      if(await api.change('row_plan_import',{plans:importPreview.items},{revisions:importPreview.revisions})){importPreview=null;api.navigate('rowPlans',null,true);api.toast('Row installation plans imported.');}
    }
    else return false;
    return true;
  }
  async function handleForm(kind,form) {
    if (!kind.startsWith('plan-')) return false;
    if(!writable()&&kind!=='plan-filter'){api.feedback('This account has read-only access.');return true;}
    if (kind==='plan-filter') {field=String(form.get('field')||'');query=String(form.get('query')||'').trim();visibleRows=60;render('rowPlans');}
    else if (kind==='plan-save') {
      if(!draft){api.feedback('Open the row constructor again.');return true;}
      draft=readDraft(form);editDirty=true;
      const error=validateRowPlan(draft,fields(),types()), duplicate=plans().find(p=>p.id!==draft.id && p.field===draft.field && p.rowNumber===draft.rowNumber);
      if(error){api.feedback(error);api.markDirty();return true;}
      if(duplicate){api.feedback('This field and row already has a plan. Edit the existing record instead.');api.markDirty();return true;}
      if(await api.change('row_plan_save',draft,{revision:editBase?.revision??null})){selectedRow=draft.id;editDirty=false;draft=null;api.navigate('rowPlan',null,true);api.toast('Installation plan saved.');}
    }
    else if (kind==='plan-type-save') {
      if(!typeBase){api.feedback('Choose a panel type again.');return true;}
      const item={...typeBase,name:String(form.get('name')||'').trim(),color:String(form.get('color')||'').trim()||null,description:String(form.get('description')||'').trim(),currentClass:String(form.get('currentClass')||'').trim(),configured:form.has('configured')};
      const error=validatePanelType(item,types());if(error){api.feedback(error);api.markDirty();return true;}
      if(await api.change('panel_type_save',item,{previous:typeBase})){typeBase=null;api.navigate('panelTypes',null,true);api.toast('Panel type saved.');}
    }
    else if (kind==='plan-import-preview') {
      importText=String(form.get('json')||'');importPreview=null;
      try {importPreview=previewImport(importText);render('rowPlanImport');api.markDirty();}catch(error){api.feedback(error.message);api.markDirty();}
    }
    else return false;
    return true;
  }
  return {
    hasScreen:screen=>ROUTES.has(screen),render,handleAction,handleForm,handleInput,
    suspendIfHidden(screen){if(screen!=='rowPlans'||listMode!=='map')siteMap?.hide();},
    reload(screen) {
      if(screen==='rowPlanEdit') {
        const latest=planById(editBase?.id || draft?.id || selectedRow);
        if(latest){selectedRow=latest.id;editBase=copy(latest);draft=copy(latest);editDirty=false;}
      } else if(screen==='panelTypeEdit') {
        const latest=typeById(selectedType);if(latest)typeBase=copy(latest);
      } else if(screen==='rowPlanImport') importPreview=null;
    },
    back(screen) {if(screen==='rowPlans')return parent;if(screen==='rowPlan')return {screen:'rowPlans',id:null};if(screen==='rowPlanEdit')return {screen:editBase?'rowPlan':'rowPlans',id:null};if(screen==='panelTypeEdit')return {screen:'panelTypes',id:null};if(screen==='panelTypes')return {screen:typeParent,id:null};if(screen==='rowPlanImport')return {screen:'rowPlans',id:null};return null;},
    navDestination:screen=>teamContext?'today':['panelTypes','panelTypeEdit'].includes(screen)&&typeParent==='settings'?'settings':'rows',
    openTeam(team) {teamContext=copy(team);parent={screen:'team',id:team.id};field=team.field;query='';api.navigate('rowPlans');}
  };
}
