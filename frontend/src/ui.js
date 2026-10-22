/** Six-step interface. Model output is text/data; it is never trusted as markup. */
export const STEPS = ['Upload', 'Recognize', 'Personality', 'Generate', 'Customize', 'Review'];
export const HABITS = [
  ['shrimp', 'Loves shrimp'], ['fish', 'Loves fish'], ['yarn', 'Plays with yarn'],
  ['sleep', 'Loves sleeping'], ['playful', 'Very playful'], ['curious', 'Curious'],
  ['calm', 'Calm'], ['cuddle', 'Loves cuddling'],
];
export const PATTERNS = {solid:'Solid',tabby:'Tabby',calico:'Calico',tortoiseshell:'Tortoiseshell',tuxedo:'Tuxedo',bicolor:'Bicolor',colorpoint:'Colorpoint',spotted:'Spotted'};
export const EYES = {copper:['Copper','#C9772B'],gold:['Gold','#D6A43A'],green:['Green','#7DA552'],hazel:['Hazel','#A39445'],blue:['Blue','#6EA2D6'],odd:['Odd-eyed','#6EA2D6']};
const MARKS = {white_muzzle:'White muzzle',white_bib:'White bib',dark_ear_tips:'Dark ear tips',forehead_m:'Forehead M',eye_patch:'Eye patch',nose_spot:'Nose spot',mask:'Dark mask'};
const MODES = {real:['Realistic Fur', 'Natural coat colors, true-to-cat markings and realistic material.'],art:['Artistic Interpretation', 'An expressive material treatment that keeps the same cat identity.']};
const SLOT_NAMES = ['Toe, top', 'Vamp, rear center', 'Side panel', 'Toe, lower side'];

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const esc = escapeHtml;
const selected = value => value ? ' selected' : '';
const disabled = value => value ? ' disabled' : '';
const currentGeneration = S => S.generations?.[S.direction] || null;
const catName = S => S.name || 'your cat';
const readyForAI = S => !!S.paidRequestsEnabled && !!S.aiConfigured && !S.busy;
const button = (action, label, {soft=true, unavailable=false}={}) => `<button type="button" class="btn ${soft?'btn-soft':'btn-dark'}" data-action="${action}"${disabled(unavailable)}>${esc(label)}</button>`;
const imageUrl = value => {
  const url = String(value || '');
  return /^\/api\/assets\/[A-Za-z0-9_-]+$/.test(url) || /^blob:/.test(url) || /^\/?a\/[A-Za-z0-9_./-]+$/.test(url) ? url : '';
};
const assetImage = (asset, alt='', className='') => {
  const url = imageUrl(asset?.url);
  return url ? `<img src="${esc(url)}" alt="${esc(alt)}"${className?` class="${esc(className)}"`:''} loading="lazy">` : '';
};
const safeHex = (value, fallback='#8F8D92') => /^#[0-9a-f]{6}$/i.test(value || '') ? value : fallback;

function aiNotice(S) {
  if (!S.paidRequestsEnabled) return '<div class="note est" role="status"><b>Paid AI requests are disabled</b>No photo analysis or image-generation request will be sent. You can enter your cat’s profile, customize the original footwear and save your work without paid services.</div>';
  if (!S.aiConfigured) return '<div class="note est" role="status"><b>AI service is not configured</b>No API request has been sent. A server-side API credential is required before photo analysis or image generation can run.</div>';
  return '<div class="note ai"><b>Photo-based AI is available</b>Analysis and generation run only when you choose their buttons. Generation creates new images from your uploaded photos.</div>';
}

function feedback(S) {
  let html = '';
  if (S.error) html += `<div class="note est" role="alert"><b>${esc(S.error.code || 'Could not complete this action')}</b>${esc(S.error.message || S.error)}</div>`;
  if (S.persistenceError && S.step !== 6) html += `<div class="note est" role="alert"><b>Changes are not saved yet</b>${esc(S.persistenceError.message || S.persistenceError)}<div class="row" style="margin-top:10px">${button('retry-save','Retry saving',{unavailable:S.busy})}</div></div>`;
  if (S.busy) html += `<div class="note" role="status" aria-live="polite"><b>${esc(S.progress?.label || S.operation || 'Working…')}</b>${S.progress?`${Math.max(0,Number(S.progress.completed)||0)} of ${Math.max(0,Number(S.progress.total)||0)} images completed.`:'Please wait for this operation to finish.'}</div>`;
  return html;
}

function uploadPanel(S) {
  const photos = S.photos || [];
  const slots = [0,1,2].map(index => {
    const photo = photos[index];
    return photo ? `<div class="photo">${assetImage(photo,`Uploaded photo ${index+1}`)}<span class="n">${index===0?'Main photo':`Photo ${index+1}`}</span><button type="button" data-remove-photo="${esc(photo.id ?? index)}" aria-label="Remove photo ${index+1}"${disabled(S.busy)}>✕</button></div>` : `<div class="slot">${['Face, front-on','Side of the body','Any favorite'][index]}</div>`;
  }).join('');
  return `<h3>Upload your cat</h3><p class="hint">Add 1–3 photos of the same cat. A clear face photo helps preserve eye color, facial markings and face shape.</p>
    <div class="drop" id="drop"><span class="ico" aria-hidden="true">↑</span><b>Drop photos here</b><p>JPEG, PNG or WebP · up to 3 · 8 MB each</p><div class="row" style="justify-content:center"><label class="btn btn-dark" for="fileIn">Choose photos</label>${button('sample', 'Try with Charcoal’s photos', {unavailable:S.busy})}</div><input type="file" id="fileIn" accept="image/jpeg,image/png,image/webp" multiple hidden${disabled(S.busy)}></div>
    <div class="photos">${slots}</div><div class="tips"><span>Daylight, no flash</span><span>Whole face visible</span><span>One cat per photo</span></div>
    <div class="field" style="margin-top:20px"><label for="catName">Your cat’s name <span style="font-weight:400;color:var(--ink-3)">(optional)</span></label><input id="catName" type="text" maxlength="24" placeholder="e.g. Mochi" value="${esc(S.name)}" autocomplete="off"${disabled(S.busy)}></div>
    <p class="privacy">Photos are saved to this website’s private browser session on the server. They are sent to an AI service only when paid AI is explicitly enabled and you request analysis or generation. Uploading photos alone does not make an AI request.</p>${aiNotice(S)}`;
}

function traitSelect(label,key,value,options,S) {
  return `<label class="field" for="trait-${key}"><span>${esc(label)}</span><select class="msel" id="trait-${key}" data-trait="${key}"${disabled(S.busy)}>${Object.entries(options).map(([id,text])=>`<option value="${id}"${selected(value===id)}>${esc(Array.isArray(text)?text[0]:text)}</option>`).join('')}</select></label>`;
}

function recognizePanel(S) {
  const t = S.traits || {};
  const colors = t.colors || {};
  const recognized = S.source === 'ai';
  return `<div class="ghead"><h3>Meet ${esc(catName(S))}</h3><span class="badge ${recognized?'ai':'est'}">${recognized?'Photo analysis':'Manual profile'}</span></div>
    ${recognized?`<div class="note ai"><b>Recognized from your uploaded photos</b>${esc(t.summary)} Check the traits below before continuing.</div>`:'<div class="note est"><b>Manual profile · not AI-recognized</b>The values below are editable starting values, not an analysis of your photos. Set them to match your cat, then confirm.</div>'}
    ${S.sourceNote?`<p class="hint">${esc(S.sourceNote)}</p>`:''}
    <div class="group"><span class="sublabel">Fur colors</span><div class="colors">${[['main','Main'],['second','Second'],['third','Third']].map(([key,label])=>`<label for="trait-color-${key}"><input type="color" id="trait-color-${key}" data-trait-color="${key}" value="${safeHex(colors[key],key==='main'?'#8F8D92':'#F6F1E8')}"${disabled(S.busy)}> ${label}</label>`).join('')}</div></div>
    <div class="group">${traitSelect('Coat pattern','pattern',t.pattern,PATTERNS,S)}${traitSelect('Coat length','coat',t.coat,{short:'Short',medium:'Medium',long:'Long'},S)}${traitSelect('Eye color','eye',t.eye,EYES,S)}</div>
    <div class="group">${traitSelect('Face shape','face',t.face,{round:'Round & chubby',classic:'Classic',wedge:'Slim wedge'},S)}${traitSelect('Ears','ears',t.ears,{small:'Small & rounded',medium:'Medium',large:'Large & pointed'},S)}${traitSelect('Expression','expression',t.expression,{alert:'Wide-eyed',unimpressed:'Unimpressed',sleepy:'Sleepy'},S)}</div>
    <div class="group"><span class="sublabel">Distinctive markings</span><div class="pills">${Object.entries(MARKS).map(([key,label])=>`<label class="pill${t.markings?.[key]?' on':''}"><input type="checkbox" data-marking="${key}"${t.markings?.[key]?' checked':''}${disabled(S.busy)}> ${esc(label)}</label>`).join('')}</div><label class="field" for="distinctive"><span>Details an owner would recognize</span><textarea id="distinctive" maxlength="643" aria-describedby="distinctive-help" placeholder="One detail per line, e.g. a white patch beside the left eye"${disabled(S.busy)}>${esc((t.distinctive || []).join('\n'))}</textarea></label><p class="cnote" id="distinctive-help">Up to four details, one per line, with 160 characters per detail.</p></div>
    <div class="group"><div class="row">${button('confirm-profile',S.profileConfirmed?'Profile confirmed':'Confirm this profile',{soft:false,unavailable:S.busy})}${button('analyze','Analyze photos with AI',{unavailable:!readyForAI(S)})}</div>${S.profileConfirmed?'<p class="hint">This confirmed profile will guide both design directions and every generated charm.</p>':''}</div>${aiNotice(S)}`;
}

function personalityPanel(S) {
  return `<h3>Personality &amp; charms</h3><p class="hint">Tell us what ${esc(catName(S))} is like. The uploaded photos define their appearance; your choices guide poses and favorite-object Jibbitz.</p>
    <div class="group"><span class="sublabel">Choose any that fit</span><div class="pills">${HABITS.map(([id,label])=>`<button type="button" class="pill${S.habits?.includes(id)?' on':''}" data-habit="${id}" aria-pressed="${!!S.habits?.includes(id)}"${disabled(S.busy)}>${esc(label)}</button>`).join('')}</div></div>
    <div class="group field"><label for="favToy">Favorite toy or object</label><input id="favToy" type="text" maxlength="60" placeholder="e.g. feather wand, shrimp plushie, cardboard box" value="${esc(S.favToy)}" autocomplete="off"${disabled(S.busy)}></div>
    <div class="group field"><label for="catNote">Habits in your own words</label><textarea id="catNote" maxlength="600" placeholder="e.g. Steals shrimp off the counter, sleeps in the laundry basket, chirps at birds."${disabled(S.busy)}>${esc(S.note)}</textarea></div>
    <div class="group"><span class="sublabel">Your personalized Jibbitz plan</span><div class="prop"><article><h4>Face &amp; expression</h4><p>Your cat’s face shape, eyes and individual markings.</p></article><article><h4>Personality pose</h4><p>A full-body charm with a pose informed by the habits you select.</p></article><article><h4>Sleeping pose</h4><p>The same cat identity in a relaxed sleeping pose.</p></article><article><h4>Favorite thing</h4><p>${S.favToy?esc(S.favToy):'Your cat’s favorite toy, food or object'} in a matching collectible style.</p></article></div><p class="cnote">These are planned concepts, not generated images. No predefined example cat will be substituted for your cat.</p></div>`;
}

function generationPanel(S) {
  const generation = currentGeneration(S);
  const cards = Object.entries(MODES).map(([mode,[title,description]])=>{
    const result = S.generations?.[mode];
    return `<button type="button" class="dir" role="radio" aria-checked="${S.direction===mode}" data-mode="${mode}"${disabled(S.busy)}><span class="dthumb">${result?assetImage(result.character,`${title} generated cat character`):'<span class="sublabel">Not generated</span>'}</span><span class="dtxt"><b>${title}</b><small>${description}</small></span></button>`;
  }).join('');
  return `<h3>Choose a direction</h3><p class="hint">Both directions keep your original cream clog, removable plush upper, heel strap cover and paw-shaped outsole.</p>
    <div class="dirs" role="radiogroup" aria-label="Design direction">${cards}</div>
    ${generation?`<div class="note ai"><b>Generated from ${esc(catName(S))}’s photos</b>This direction has a saved cat identity, upper material and ${generation.charms?.length || 0} personalized charms.</div><div class="tray">${(generation.charms || []).map(charm=>`<span class="tchip">${assetImage(charm.asset,charm.title)}</span>`).join('')}</div>`:'<div class="note est"><b>No AI artwork generated for this direction</b>The preview shows your original footwear only. It is not a personalized AI result.</div>'}
    <div class="row" style="margin-top:16px">${button('generate',generation?'Generate this direction again':`Generate ${MODES[S.direction || 'real'][0]}`,{soft:false,unavailable:!readyForAI(S) || !S.profileConfirmed})}</div>
    <p class="cnote">A first direction requests 6 images: a shared cat identity, one material texture and four Jibbitz. The other direction can reuse the identity. No request runs automatically.</p>${aiNotice(S)}<p class="hint">You can continue to customize and save the original footwear without generating artwork.</p>`;
}

function customizePanel(S) {
  const d = S.design || {};
  const generation = currentGeneration(S);
  const charms = generation?.charms || [];
  const ordered = (d.charms || []).map(id=>charms.find(charm=>charm.id===id)).filter(Boolean);
  const order = ordered.map((charm,index)=>`<li><span class="num">${index+1}</span><span class="ci">${assetImage(charm.asset,charm.title)}</span><span class="meta">${esc(charm.title)}<small>${esc(SLOT_NAMES[index] || 'Additional charm')} · ${esc(charm.material || '')}</small></span><button type="button" class="ib" data-up="${index}" aria-label="Move ${esc(charm.title)} earlier"${disabled(index===0 || S.busy)}>↑</button><button type="button" class="ib" data-down="${index}" aria-label="Move ${esc(charm.title)} later"${disabled(index===ordered.length-1 || S.busy)}>↓</button><button type="button" class="ib" data-regenerate-charm="${esc(charm.id)}" aria-label="Generate another ${esc(charm.title)}" title="Generate another image"${disabled(!readyForAI(S))}>↻</button><button type="button" class="ib" data-remove-charm="${esc(charm.id)}" aria-label="Remove ${esc(charm.title)}"${disabled(S.busy)}>✕</button></li>`).join('');
  return `<h3>Make it yours</h3><p class="hint">Adjust the removable pieces and charm placement. Your original cream clog geometry and paw outsole stay protected.</p>${generation?'':'<div class="note est"><b>Footwear preview · no AI artwork generated</b>You can test the removable pieces and save this design. No cat character or personalized charm has been generated.</div>'}
    <div class="group"><span class="sublabel">Direction</span><div class="pills">${Object.entries(MODES).map(([mode,[label]])=>`<button type="button" class="pill${S.direction===mode?' on':''}" data-mode="${mode}" aria-pressed="${S.direction===mode}"${disabled(S.busy)}>${label}</button>`).join('')}</div></div>
    <div class="group"><span class="sublabel">Fabric upper</span><div class="switch"><span><b id="upper-label">Plush upper ${d.upperOn?'attached':'removed'}</b><small>Removable fabric covers the vamp above the sole line.</small></span><button type="button" class="tog" role="switch" aria-checked="${!!d.upperOn}" aria-labelledby="upper-label" data-action="upper-toggle"${disabled(S.busy)}></button></div></div>
    <div class="group"><span class="sublabel">Heel strap cover</span><div class="switch"><span><b id="strap-label">Strap cover ${d.strapOn?'attached':'removed'}</b><small>The original pivot and working strap stay exposed.</small></span><button type="button" class="tog" role="switch" aria-checked="${!!d.strapOn}" aria-labelledby="strap-label" data-action="strap-toggle"${disabled(S.busy)}></button></div>${d.strapOn?`<label class="field" for="strapStyle"><span>Strap material treatment</span><select class="msel" id="strapStyle"${disabled(S.busy)}><option value="match"${selected(d.strapStyle==='match')}>Match the upper</option><option value="accent"${selected(d.strapStyle==='accent')}>Eye-color accent</option></select></label>`:''}</div>
    ${generation?`<div class="group field"><label for="scaleIn">Texture scale · ${Math.round((Number(d.scale)||1)*100)}%</label><input type="range" id="scaleIn" min="0.5" max="2" step="0.05" value="${Math.min(2,Math.max(.5,Number(d.scale)||1))}"><p class="hint">Changes texture placement, not your cat’s identity or markings.</p></div>`:''}
    <div class="group"><div class="ghead"><span class="sublabel">Personalized Jibbitz · order sets placement</span><span>${ordered.length} selected</span></div>${order?`<ol class="order">${order}</ol>`:'<p class="hint">No generated charms selected. Nothing from an example-cat library will be added automatically.</p>'}${charms.length?button('restore-charms','Restore all generated charms',{unavailable:S.busy}):''}</div>`;
}

function reviewPanel(S) {
  const d = S.design || {};
  const t = S.traits || {};
  const generation = currentGeneration(S);
  const charms = generation?.charms || [];
  const selectedCharms = (d.charms || []).map(id=>charms.find(charm=>charm.id===id)).filter(Boolean);
  const habits = HABITS.filter(([id])=>S.habits?.includes(id)).map(([,label])=>label).join(', ');
  const rows = [
    ['Cat', catName(S)], ['Profile source',S.source==='ai'?'AI analysis, reviewed by owner':'Manual profile, entered by owner'],
    ['Coat', `${PATTERNS[t.pattern] || 'Not set'} · ${t.coat || 'Not set'}`], ['Eyes', EYES[t.eye]?.[0] || 'Not set'],
    ['Direction',MODES[S.direction || 'real'][0]], ['Fabric upper',d.upperOn?'Removable plush upper attached':'Removed'],
    ['Heel strap cover',d.strapOn?'Removable wrap attached':'Removed'], ['Base & outsole','Original cream clog and paw-shaped outsole preserved'],
    ['Personality',habits || 'Not specified'], ['Favorite thing',S.favToy || 'Not specified'],
    ['AI artwork',generation?'Saved generated images':'Not generated; original-footwear preview only'],
  ];
  return `<h3>${esc(catName(S))}’s pair</h3><p class="hint">Review the confirmed profile, removable pieces and saved artwork. This is a design specification, not a production order.</p>
    <div class="spec"><h4>Design summary</h4><table>${rows.map(([label,value])=>`<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('')}</table></div>
    <div class="spec"><h4>Personalized Jibbitz <small>${selectedCharms.length} charms</small></h4>${selectedCharms.length?`<div class="tray">${selectedCharms.map(charm=>`<span class="tchip" title="${esc(charm.title)}">${assetImage(charm.asset,charm.title)}</span>`).join('')}</div><ul>${selectedCharms.map(charm=>`<li>${esc(charm.title)}</li>`).join('')}</ul>`:'<p>No generated artwork is included in this design yet.</p>'}</div>
    <div class="note ${S.persistenceError?'est':'ai'}" id="saveStatus" role="status" aria-live="polite"><b>${S.persistenceError?'Saving needs attention':S.savedAt?'Design saved':'Saving your design'}</b>${S.persistenceError?'Keep this page open and retry when the connection is available.':S.savedAt?'This design is saved on this server for this browser. Keep the same browser cookies to reopen it.':'The design is being saved to this server for this browser. Wait for confirmation before closing the page.'}${S.persistenceError?`<div class="row" style="margin-top:10px">${button('retry-save','Retry saving',{unavailable:S.busy})}</div>`:''}</div>
    <div class="row" style="margin-top:20px">${button('download-json','Download design JSON')}${button('download-html','Download design sheet')}</div><div class="row" style="margin-top:14px">${button('restart','Start a new cat',{unavailable:S.busy})}</div>
    <p class="cnote">Production review is not connected. No order is submitted and no payment is collected.</p>`;
}

export function renderPanel(S) {
  const panels = [null,uploadPanel,recognizePanel,personalityPanel,generationPanel,customizePanel,reviewPanel];
  const render = panels[Math.max(1,Math.min(6,Number(S.step)||1))];
  return `<div class="panel">${feedback(S)}${render(S)}</div>`;
}
