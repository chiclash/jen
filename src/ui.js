/** School prototype interface. Recognition and design output are clearly labelled simulations. */
export const STEPS = ['Upload', 'Recognize', 'Personality', 'Generate', 'Customize', 'Review'];
export const HABITS = [
  ['shrimp', 'Loves shrimp'], ['fish', 'Loves fish'], ['yarn', 'Plays with yarn'],
  ['sleep', 'Loves sleeping'], ['playful', 'Very playful'], ['curious', 'Curious'],
  ['calm', 'Calm'], ['cuddle', 'Loves cuddling'],
];
export const PATTERNS = {solid:'Solid',tabby:'Tabby',calico:'Calico',tortoiseshell:'Tortoiseshell',tuxedo:'Tuxedo',bicolor:'Bicolor',colorpoint:'Colorpoint',spotted:'Spotted'};
export const EYES = {copper:['Copper','#C9772B'],gold:['Gold','#D6A43A'],green:['Green','#7DA552'],hazel:['Hazel','#A39445'],blue:['Blue','#6EA2D6'],odd:['Odd-eyed','#6EA2D6']};
const MARKS = {white_muzzle:'White muzzle',white_bib:'White bib',dark_ear_tips:'Dark ear tips',forehead_m:'Forehead M',eye_patch:'Eye patch',nose_spot:'Nose spot',mask:'Dark mask'};
const MODES = {real:['Realistic Fur', 'A natural-tone material preview with keepsakes made from your actual photo.'],art:['Artistic Interpretation', 'A decorative material preview and colorful frames around your actual photo.']};
const SLOT_NAMES = ['Toe, top', 'Vamp, rear center', 'Side panel', 'Toe, lower side'];

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const esc = escapeHtml;
const selected = value => value ? ' selected' : '';
const disabled = value => value ? ' disabled' : '';
const currentGeneration = S => S.generations?.[S.direction] || null;
const catName = S => S.name || 'your cat';
const readyForAI = S => !S.busy && !!S.photos?.length; // Local simulation only; never an API capability.
const button = (action, label, {soft=true, unavailable=false}={}) => `<button type="button" class="btn ${soft?'btn-soft':'btn-dark'}" data-action="${action}"${disabled(unavailable)}>${esc(label)}</button>`;
const imageUrl = value => {
  const url = String(value || '');
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url) || /^blob:/.test(url) || /^(?:\.\/)?a\/[A-Za-z0-9_/-]+\.(?:png|webp|jpe?g)$/.test(url) ? url : '';
};
const assetImage = (asset, alt='', className='') => {
  const url = imageUrl(asset?.url);
  return url ? `<img src="${esc(url)}" alt="${esc(alt)}"${className?` class="${esc(className)}"`:''} loading="lazy">` : '';
};
const safeHex = (value, fallback='#8F8D92') => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;

function aiNotice() {
  return '<div class="note est" role="status"><b>School prototype · simulated personalization</b>Recognition is a local color estimate. Design previews combine your photo, editable colors and original reference artwork. No AI images are generated, and no photos leave this browser.</div>';
}

function feedback(S) {
  let html = '';
  if (S.error) html += `<div class="note est" role="alert"><b>${esc(S.error.code || 'Could not complete this action')}</b>${esc(S.error.message || S.error)}</div>`;
  if (S.persistenceError && S.step !== 6) html += `<div class="note est" role="alert"><b>Changes are not saved yet</b>${esc(S.persistenceError.message || S.persistenceError)}<div class="row" style="margin-top:10px">${button('retry-save','Retry saving',{unavailable:S.busy})}</div></div>`;
  if (S.busy) html += `<div class="note" role="status" aria-live="polite"><b>${esc(S.progress?.label || S.operation || 'Working…')}</b>${S.progress?`${Math.max(0,Number(S.progress.completed)||0)} of ${Math.max(0,Number(S.progress.total)||0)} local preview items prepared.`:'Please wait for this operation to finish.'}</div>`;
  return html;
}

function uploadPanel(S) {
  const photos = S.photos || [];
  const slots = [0,1,2].map(index => {
    const photo = photos[index];
    return photo ? `<div class="photo">${assetImage(photo,`Uploaded photo ${index+1}`)}<span class="n">${index===0?'Main photo':`Photo ${index+1}`}</span><button type="button" data-remove-photo="${esc(photo.id ?? index)}" aria-label="Remove photo ${index+1}"${disabled(S.busy)}>✕</button></div>` : `<div class="slot">${['Face, front-on','Side of the body','Any favorite'][index]}</div>`;
  }).join('');
  return `<h3>Upload your cat</h3><p class="hint">Add 1–3 photos of the same cat. Your actual photo becomes a keepsake in the simulated design; a clear face photo works best.</p>
    <div class="drop" id="drop"><span class="ico" aria-hidden="true">↑</span><b>Drop photos here</b><p>JPEG, PNG or WebP · up to 3 · 8 MB each</p><div class="row" style="justify-content:center"><label class="btn btn-dark" for="fileIn">Choose photos</label>${button('sample', 'Try with Charcoal’s photos', {unavailable:S.busy})}</div><input type="file" id="fileIn" accept="image/jpeg,image/png,image/webp" multiple hidden${disabled(S.busy)}></div>
    <div class="photos">${slots}</div><div class="tips"><span>Daylight, no flash</span><span>Whole face visible</span><span>One cat per photo</span></div>
    <div class="field" style="margin-top:20px"><label for="catName">Your cat’s name <span style="font-weight:400;color:var(--ink-3)">(optional)</span></label><input id="catName" type="text" maxlength="24" placeholder="e.g. Mochi" value="${esc(S.name)}" autocomplete="off"${disabled(S.busy)}></div>
    <p class="privacy">Photos and designs stay in this browser and are saved locally when browser storage is available. This school prototype has no account, backend or AI connection. Clearing site data removes your saved design.</p>${aiNotice(S)}`;
}

function traitSelect(label,key,value,options,S) {
  return `<label class="field" for="trait-${key}"><span>${esc(label)}</span><select class="msel" id="trait-${key}" data-trait="${key}"${disabled(S.busy)}>${Object.entries(options).map(([id,text])=>`<option value="${id}"${selected(value===id)}>${esc(Array.isArray(text)?text[0]:text)}</option>`).join('')}</select></label>`;
}

function recognizePanel(S) {
  const t = S.traits || {};
  const colors = t.colors || {};
  const recognized = S.source === 'demo';
  return `<div class="ghead"><h3>Meet ${esc(catName(S))}</h3><span class="badge ${recognized?'ai':'est'}">${recognized?'Recognition demo':'Manual profile'}</span></div>
    ${recognized?`<div class="note ai"><b>Simulated recognition · color estimate only</b>${esc(t.summary)} Check every field below: eye color, face shape and markings are not recognized by AI.</div>`:'<div class="note est"><b>Manual profile · school prototype</b>The values below are editable starting values. You can run the local color-estimate demo, then set every field to match your cat and confirm.</div>'}
    ${S.sourceNote?`<p class="hint">${esc(S.sourceNote)}</p>`:''}
    <div class="group"><span class="sublabel">Fur colors</span><div class="colors">${[['main','Main'],['second','Second'],['third','Third']].map(([key,label])=>`<label for="trait-color-${key}"><input type="color" id="trait-color-${key}" data-trait-color="${key}" value="${safeHex(colors[key],key==='main'?'#8F8D92':'#F6F1E8')}"${disabled(S.busy)}> ${label}</label>`).join('')}</div></div>
    <div class="group">${traitSelect('Coat pattern','pattern',t.pattern,PATTERNS,S)}${traitSelect('Coat length','coat',t.coat,{short:'Short',medium:'Medium',long:'Long'},S)}${traitSelect('Eye color','eye',t.eye,EYES,S)}</div>
    <div class="group">${traitSelect('Face shape','face',t.face,{round:'Round & chubby',classic:'Classic',wedge:'Slim wedge'},S)}${traitSelect('Ears','ears',t.ears,{small:'Small & rounded',medium:'Medium',large:'Large & pointed'},S)}${traitSelect('Expression','expression',t.expression,{alert:'Wide-eyed',unimpressed:'Unimpressed',sleepy:'Sleepy'},S)}</div>
    <div class="group"><span class="sublabel">Distinctive markings</span><div class="pills">${Object.entries(MARKS).map(([key,label])=>`<label class="pill${t.markings?.[key]?' on':''}"><input type="checkbox" data-marking="${key}"${t.markings?.[key]?' checked':''}${disabled(S.busy)}> ${esc(label)}</label>`).join('')}</div><label class="field" for="distinctive"><span>Details an owner would recognize</span><textarea id="distinctive" maxlength="643" aria-describedby="distinctive-help" placeholder="One detail per line, e.g. a white patch beside the left eye"${disabled(S.busy)}>${esc((t.distinctive || []).join('\n'))}</textarea></label><p class="cnote" id="distinctive-help">Up to four details, one per line, with 160 characters per detail.</p></div>
    <div class="group"><div class="row">${button('confirm-profile',S.profileConfirmed?'Profile confirmed':'Confirm this profile',{soft:false,unavailable:S.busy})}${button('analyze','Run recognition demo',{unavailable:!readyForAI(S)})}</div>${S.profileConfirmed?'<p class="hint">This confirmed profile guides the simulated materials and photo-keepsake frames in both directions.</p>':''}</div>${aiNotice(S)}`;
}

function personalityPanel(S) {
  return `<h3>Personality &amp; charms</h3><p class="hint">Tell us what ${esc(catName(S))} is like. This school prototype uses your actual photo for keepsakes and selects original toy artwork to illustrate the concept. It does not generate new cat poses.</p>
    <div class="group"><span class="sublabel">Choose any that fit</span><div class="pills">${HABITS.map(([id,label])=>`<button type="button" class="pill${S.habits?.includes(id)?' on':''}" data-habit="${id}" aria-pressed="${!!S.habits?.includes(id)}"${disabled(S.busy)}>${esc(label)}</button>`).join('')}</div></div>
    <div class="group field"><label for="favToy">Favorite toy or object</label><input id="favToy" type="text" maxlength="60" placeholder="e.g. feather wand, shrimp plushie, cardboard box" value="${esc(S.favToy)}" autocomplete="off"${disabled(S.busy)}></div>
    <div class="group field"><label for="catNote">Habits in your own words</label><textarea id="catNote" maxlength="600" placeholder="e.g. Steals shrimp off the counter, sleeps in the laundry basket, chirps at birds."${disabled(S.busy)}>${esc(S.note)}</textarea></div>
    <div class="group"><span class="sublabel">Your simulated Jibbitz plan</span><div class="prop"><article><h4>Photo portrait</h4><p>A framed crop of your uploaded photo. The photo itself is not AI-generated or redrawn.</p></article><article><h4>Personality photo keepsake</h4><p>Your actual photo in a keepsake frame, with your selected personality recorded in the design.</p></article><article><h4>Sleepy photo keepsake</h4><p>Your photo with the original moon artwork. It does not turn your cat into a new sleeping pose.</p></article><article><h4>Favorite-object reference artwork</h4><p>${S.favToy?esc(S.favToy):'Your cat’s favorite toy, food or object'} is represented by the closest original toy illustration selected locally.</p></article></div><p class="cnote">These are clearly simulated keepsakes, not AI-generated characters. Your uploaded photo is used for the cat; original moon and toy artwork remain labelled reference illustrations.</p></div>`;
}

function generationPanel(S) {
  const generation = currentGeneration(S);
  const cards = Object.entries(MODES).map(([mode,[title,description]])=>{
    const result = S.generations?.[mode];
    return `<button type="button" class="dir" role="radio" aria-checked="${S.direction===mode}" data-mode="${mode}"${disabled(S.busy)}><span class="dthumb">${result?assetImage(result.character,`${title} simulated photo keepsake`):'<span class="sublabel">Not simulated yet</span>'}</span><span class="dtxt"><b>${title}</b><small>${description}</small></span></button>`;
  }).join('');
  return `<h3>Choose a direction</h3><p class="hint">Both directions keep your original cream clog, removable plush upper, heel strap cover and paw-shaped outsole.</p>
    <div class="dirs" role="radiogroup" aria-label="Design direction">${cards}</div>
    ${generation?`<div class="note ai"><b>Simulated design using ${esc(catName(S))}’s photo</b>This direction combines a photo keepsake, a color-based material preview and ${generation.charms?.length || 0} demo charms. No AI generation took place.</div><div class="tray">${(generation.charms || []).map(charm=>`<span class="tchip">${assetImage(charm.asset,charm.title)}</span>`).join('')}</div>`:'<div class="note est"><b>This direction has not been simulated yet</b>The preview shows the original footwear. Simulate a design to try local photo keepsakes and editable material colors.</div>'}
    <div class="row" style="margin-top:16px">${button('generate',generation?'Try another demo variation':'Simulate design',{soft:false,unavailable:!readyForAI(S) || !S.profileConfirmed})}</div>
    <p class="cnote">The simulation prepares one photo keepsake, one material preview and four demo charms entirely in your browser. It does not contact an AI service.</p>${aiNotice(S)}<p class="hint">You can also continue with the original footwear and save a design without running the simulation.</p>`;
}

function customizePanel(S) {
  const d = S.design || {};
  const generation = currentGeneration(S);
  const charms = generation?.charms || [];
  const ordered = (d.charms || []).map(id=>charms.find(charm=>charm.id===id)).filter(Boolean);
  const order = ordered.map((charm,index)=>`<li><span class="num">${index+1}</span><span class="ci">${assetImage(charm.asset,charm.title)}</span><span class="meta">${esc(charm.title)}<small>${esc(SLOT_NAMES[index] || 'Additional charm')} · ${esc(charm.material || '')}</small></span><button type="button" class="ib" data-up="${index}" aria-label="Move ${esc(charm.title)} earlier"${disabled(index===0 || S.busy)}>↑</button><button type="button" class="ib" data-down="${index}" aria-label="Move ${esc(charm.title)} later"${disabled(index===ordered.length-1 || S.busy)}>↓</button><button type="button" class="ib" data-regenerate-charm="${esc(charm.id)}" aria-label="Try a demo variation of ${esc(charm.title)}" title="Try a local demo variation"${disabled(!readyForAI(S))}>↻</button><button type="button" class="ib" data-remove-charm="${esc(charm.id)}" aria-label="Remove ${esc(charm.title)}"${disabled(S.busy)}>✕</button></li>`).join('');
  return `<h3>Make it yours</h3><p class="hint">Adjust the removable pieces and charm placement. Your original cream clog geometry and paw outsole stay protected.</p>${generation?'<div class="note est"><b>School prototype · simulated design</b>These are photo keepsakes, locally composed materials and labelled original illustrations. No new cat character or AI image has been generated.</div>':'<div class="note est"><b>School prototype · original-footwear preview</b>You can test the removable pieces and save this design. Run the simulation to add photo keepsakes; no AI artwork is generated in this version.</div>'}
    <div class="group"><span class="sublabel">Direction</span><div class="pills">${Object.entries(MODES).map(([mode,[label]])=>`<button type="button" class="pill${S.direction===mode?' on':''}" data-mode="${mode}" aria-pressed="${S.direction===mode}"${disabled(S.busy)}>${label}</button>`).join('')}</div></div>
    <div class="group"><span class="sublabel">Fabric upper</span><div class="switch"><span><b id="upper-label">Plush upper ${d.upperOn?'attached':'removed'}</b><small>Removable fabric covers the vamp above the sole line.</small></span><button type="button" class="tog" role="switch" aria-checked="${!!d.upperOn}" aria-labelledby="upper-label" data-action="upper-toggle"${disabled(S.busy)}></button></div></div>
    <div class="group"><span class="sublabel">Heel strap cover</span><div class="switch"><span><b id="strap-label">Strap cover ${d.strapOn?'attached':'removed'}</b><small>The original pivot and working strap stay exposed.</small></span><button type="button" class="tog" role="switch" aria-checked="${!!d.strapOn}" aria-labelledby="strap-label" data-action="strap-toggle"${disabled(S.busy)}></button></div>${d.strapOn?`<label class="field" for="strapStyle"><span>Strap material treatment</span><select class="msel" id="strapStyle"${disabled(S.busy)}><option value="match"${selected(d.strapStyle==='match')}>Match the upper</option><option value="accent"${selected(d.strapStyle==='accent')}>Eye-color accent</option></select></label>`:''}</div>
    ${generation?`<div class="group field"><label for="scaleIn">Texture scale · ${Math.round((Number(d.scale)||1)*100)}%</label><input type="range" id="scaleIn" min="0.5" max="2" step="0.05" value="${Math.min(2,Math.max(.5,Number(d.scale)||1))}"><p class="hint">Changes placement of the simulated material pattern; your photo is unchanged.</p></div>`:''}
    <div class="group"><div class="ghead"><span class="sublabel">Demo Jibbitz · order sets placement</span><span>${ordered.length} selected</span></div>${order?`<ol class="order">${order}</ol>`:'<p class="hint">No demo charms selected. Run the simulation to add your photo keepsakes and labelled reference artwork.</p>'}${charms.length?button('restore-charms','Restore all demo charms',{unavailable:S.busy}):''}</div>`;
}

function reviewPanel(S) {
  const d = S.design || {};
  const t = S.traits || {};
  const generation = currentGeneration(S);
  const charms = generation?.charms || [];
  const selectedCharms = (d.charms || []).map(id=>charms.find(charm=>charm.id===id)).filter(Boolean);
  const habits = HABITS.filter(([id])=>S.habits?.includes(id)).map(([,label])=>label).join(', ');
  const rows = [
    ['Cat', catName(S)], ['Profile source',S.source==='demo'?'Simulated color estimate, confirmed by owner':'Manual profile, entered by owner'],
    ['Coat', `${PATTERNS[t.pattern] || 'Not set'} · ${t.coat || 'Not set'}`], ['Eyes', EYES[t.eye]?.[0] || 'Not set'],
    ['Direction',MODES[S.direction || 'real'][0]], ['Fabric upper',d.upperOn?'Removable plush upper attached':'Removed'],
    ['Heel strap cover',d.strapOn?'Removable wrap attached':'Removed'], ['Base & outsole','Original cream clog and paw-shaped outsole preserved'],
    ['Personality',habits || 'Not specified'], ['Favorite thing',S.favToy || 'Not specified'],
    ['Prototype artwork',generation?'Simulated photo keepsakes and original reference art':'Original-footwear preview; simulation not run'],
  ];
  return `<h3>${esc(catName(S))}’s pair</h3><p class="hint">Review the confirmed profile, removable pieces and simulated artwork. This is a school design prototype, not an AI-generated product or production order.</p>
    <div class="spec"><h4>Design summary</h4><table>${rows.map(([label,value])=>`<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('')}</table></div>
    <div class="spec"><h4>Demo Jibbitz <small>${selectedCharms.length} charms</small></h4>${selectedCharms.length?`<div class="tray">${selectedCharms.map(charm=>`<span class="tchip" title="${esc(charm.title)}">${assetImage(charm.asset,charm.title)}</span>`).join('')}</div><ul>${selectedCharms.map(charm=>`<li>${esc(charm.title)}</li>`).join('')}</ul>`:'<p>No simulated keepsakes are included in this design yet.</p>'}</div>
    <div class="note ${S.persistenceError?'est':'ai'}" id="saveStatus" role="status" aria-live="polite"><b>${S.persistenceError?'Saving needs attention':S.savedAt?'Design saved':'Saving your design'}</b>${S.persistenceError?'Keep this page open and retry, or download your design before leaving.':S.savedAt?'This design is saved locally in this browser. Reopen it on the same browser and site; clearing site data removes the saved copy.':'The design is being saved in this browser. Wait for confirmation, or download a copy before closing the page.'}${S.persistenceError?`<div class="row" style="margin-top:10px">${button('retry-save','Retry saving',{unavailable:S.busy})}</div>`:''}</div>
    <div class="row" style="margin-top:20px">${button('download-json','Download design JSON')}${button('download-html','Download design sheet')}</div><div class="row" style="margin-top:14px">${button('restart','Start a new cat',{unavailable:S.busy})}</div>
    <p class="cnote">School prototype disclaimer: recognition and design preparation are simulations, not AI results. Nothing is sent to production. Exported files are demonstration design sheets, not manufacturing specifications.</p>`;
}

export function renderPanel(S) {
  const panels = [null,uploadPanel,recognizePanel,personalityPanel,generationPanel,customizePanel,reviewPanel];
  const render = panels[Math.max(1,Math.min(6,Number(S.step)||1))];
  return `<div class="panel">${feedback(S)}${render(S)}</div>`;
}
