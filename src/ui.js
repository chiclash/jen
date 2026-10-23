/** School prototype: owner facts, AI availability and opt-in references are explicit. */
export const STEPS = ['Upload', 'Analyze', 'Personality', 'Generate', 'Customize', 'Review'];
export const HABITS = [
  ['shrimp', 'Loves shrimp'], ['fish', 'Loves fish'], ['yarn', 'Plays with yarn'],
  ['sleep', 'Loves sleeping'], ['playful', 'Very playful'], ['curious', 'Curious'],
  ['calm', 'Calm'], ['cuddle', 'Loves cuddling'],
];
export const PATTERNS = {solid:'Solid',tabby:'Tabby',calico:'Calico',tortoiseshell:'Tortoiseshell',tuxedo:'Tuxedo',bicolor:'Bicolor',colorpoint:'Colorpoint',spotted:'Spotted'};
export const EYES = {copper:['Copper','#C9772B'],gold:['Gold','#D6A43A'],green:['Green','#7DA552'],hazel:['Hazel','#A39445'],blue:['Blue','#6EA2D6'],odd:['Odd-eyed','#6EA2D6']};
const MARKS = {white_muzzle:'White muzzle',white_bib:'White bib',dark_ear_tips:'Dark ear tips',forehead_m:'Forehead M',eye_patch:'Eye patch',nose_spot:'Nose spot',mask:'Dark mask'};
const MODES = {
  real:['Realistic Fur', 'Fine short-pile faux fur in owner-entered coat tones.'],
  art:['Artistic Interpretation', 'A decorative material interpretation of the owner-entered profile.'],
};
const SLOT_NAMES = ['Toe, top', 'Vamp, rear center', 'Side panel', 'Toe, lower side'];
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const esc = escapeHtml;
const selected = value => value ? ' selected' : '';
const disabled = value => value ? ' disabled' : '';
const catName = S => S.name || 'your cat';
const currentGeneration = S => S.generations?.[S.direction] || null;
const button = (action,label,{soft=true,unavailable=false}={}) => `<button type="button" class="btn ${soft?'btn-soft':'btn-dark'}" data-action="${action}"${disabled(unavailable)}>${esc(label)}</button>`;
const validHex = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const imageUrl = value => {
  const url = String(value || '');
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url) || /^blob:/.test(url) || /^(?:\.\/)?a\/[A-Za-z0-9_/-]+\.(?:png|webp|jpe?g)$/.test(url) ? url : '';
};
const assetImage = (asset,alt='',className='') => {
  const url = imageUrl(asset?.url);
  return url ? `<img src="${esc(url)}" alt="${esc(alt)}"${className?` class="${esc(className)}"`:''} loading="lazy">` : '';
};
function origin(S,key,value) {
  if (value === '' || value === null || value === undefined) return 'Not specified';
  const source = S.traitSources?.[key];
  if (source === 'ai') return 'AI analysis';
  if (source === 'owner-corrected-ai') return 'Owner correction to AI analysis';
  if (source === 'owner') return 'Owner-entered';
  return 'Not confirmed';
}
function provenance(S,key,value) { return `<small class="cnote">Source: ${esc(origin(S,key,value))}</small>`; }
function aiNotice() {
  return '<div class="note est" role="status"><b>AI analysis and generation unavailable</b>This static prototype does not infer cat characteristics or generate personalized images. Owner-entered traits, optional photo color suggestions and an interactive reference demo are kept separate.</div>';
}
function feedback(S) {
  let html = '';
  if (S.error) html += `<div class="note est" role="alert"><b>${esc(S.error.code || 'Could not complete this action')}</b>${esc(S.error.message || S.error)}</div>`;
  if (S.persistenceError && S.step !== 6) html += `<div class="note est" role="alert"><b>Changes are not saved yet</b>${esc(S.persistenceError.message || S.persistenceError)}<div class="row" style="margin-top:10px">${button('retry-save','Retry saving',{unavailable:S.busy})}</div></div>`;
  if (S.busy) html += `<div class="note" role="status" aria-live="polite"><b>${esc(S.progress?.label || S.operation || 'Working…')}</b>${S.progress?`${Math.max(0,Number(S.progress.completed)||0)} of ${Math.max(0,Number(S.progress.total)||0)} local preview items prepared.`:'Please wait for this operation to finish.'}</div>`;
  return html;
}
function uploadPanel(S) {
  const slots = [0,1,2].map(index => {
    const photo = S.photos?.[index];
    return photo ? `<div class="photo">${assetImage(photo,`Uploaded photo ${index+1}`)}<span class="n">${index===0?'Main photo':`Photo ${index+1}`}</span><button type="button" data-remove-photo="${esc(photo.id ?? index)}" aria-label="Remove photo ${index+1}"${disabled(S.busy)}>✕</button></div>` : `<div class="slot">${['Face, front-on','Side of the body','Any favorite'][index]}</div>`;
  }).join('');
  return `<h3>Upload your cat</h3><p class="hint">Choose 1–3 photos of the same cat together. Your actual photo stays visible while you enter and confirm their features. Choosing photos again starts a new cat and clears the previous profile and design.</p>
    <div class="drop" id="drop"><span class="ico" aria-hidden="true">↑</span><b>Drop photos here</b><p>JPEG, PNG or WebP · up to 3 · 8 MB each</p><div class="row" style="justify-content:center"><label class="btn btn-dark" for="fileIn">Choose photos</label>${button('sample','Try with Charcoal’s photos',{unavailable:S.busy})}</div><input type="file" id="fileIn" accept="image/jpeg,image/png,image/webp" multiple hidden${disabled(S.busy)}></div>
    <div class="photos">${slots}</div><div class="tips"><span>Daylight, no flash</span><span>Whole face visible</span><span>One cat per photo</span></div>
    <div class="field" style="margin-top:20px"><label for="catName">Your cat’s name <span style="font-weight:400;color:var(--ink-3)">(optional)</span></label><input id="catName" type="text" maxlength="24" placeholder="e.g. Mochi" value="${esc(S.name)}" autocomplete="off"${disabled(S.busy)}></div>
    <p class="privacy">Photos and edits stay in this browser and are saved locally when browser storage is available. Uploading a photo does not assign traits or select an example cat. Clearing site data removes the saved design.</p>${aiNotice()}`;
}
function traitSelect(label,key,value,options,S) {
  const known = Object.prototype.hasOwnProperty.call(options,value);
  return `<label class="field" for="trait-${key}"><span>${esc(label)}</span><select class="msel" id="trait-${key}" data-trait="${key}"${disabled(S.busy)}><option value=""${selected(!known)}>Not specified</option>${Object.entries(options).map(([id,text])=>`<option value="${id}"${selected(value===id)}>${esc(Array.isArray(text)?text[0]:text)}</option>`).join('')}</select>${provenance(S,key,known?value:null)}</label>`;
}
function colorField(S,key,label) {
  const value = S.traits?.colors?.[key];
  if (!validHex(value)) return `<div class="field"><span>${label} · <b>Not specified</b></span><button type="button" class="pill sm" data-set-color="${key}"${disabled(S.busy)}>Set ${label.toLowerCase()} color</button><small class="cnote">No color has been inferred or selected.</small></div>`;
  return `<div class="field"><label for="trait-color-${key}"><input type="color" id="trait-color-${key}" data-trait-color="${key}" value="${value}"${disabled(S.busy)}> ${label} ${esc(value)}</label>${provenance(S,`colors.${key}`,value)}<button type="button" class="textbtn" data-clear-color="${key}"${disabled(S.busy)}>Clear ${label.toLowerCase()} color</button></div>`;
}
function analysisStatus(S) {
  if (!S.aiAnalysis) return '<div class="note est" id="aiAnalysisStatus" role="status"><b>AI analysis: not performed · unavailable</b>No coat pattern, eye color, face shape, expression or markings have been inferred. Unknown fields remain “Not specified”.</div>';
  return `<div class="note ai" id="aiAnalysisStatus"><b>AI analysis record</b>${esc(S.aiAnalysis.summary || S.aiAnalysis.status || 'A separate analysis record is available.')} Owner corrections below are recorded separately.</div>`;
}
function recognizePanel(S) {
  const t = S.traits || {};
  const suggestions = (S.colorSuggestions || []).map(item => typeof item==='string'?item:item?.hex).filter(validHex);
  return `<div class="ghead"><h3>Meet ${esc(catName(S))}</h3><span class="badge est">${S.source==='owner'||S.source==='owner-corrected-ai'?'Owner-entered profile':'Unconfirmed profile'}</span></div>
    ${analysisStatus(S)}<div class="row" style="margin-top:14px">${button('analyze','Analyze cat characteristics',{unavailable:S.busy || !S.photos?.length})}</div>
    <div class="note"><b>Owner-entered and corrected traits</b>Use the uploaded photo as your reference. Select only the features you know; unknown traits can remain unspecified. Each field shows where its value came from.</div>
    ${S.sourceNote?`<p class="hint">${esc(S.sourceNote)}</p>`:''}
    <div class="group"><span class="sublabel">Owner-selected fur colors</span><div class="colors">${[['main','Main'],['second','Second'],['third','Third']].map(([key,label])=>colorField(S,key,label)).join('')}</div></div>
    <div class="group"><span class="sublabel">Optional photo/background color sampler</span><p class="cnote">This samples image pixels, which may include furniture, lighting or other background colors. It does not recognize a cat or fill any profile field automatically.</p><div class="row">${button('estimate-colors','Show photo color suggestions',{unavailable:S.busy || !S.photos?.length})}</div>${suggestions.length?`<div class="palette" id="colorSuggestions">${suggestions.map(color=>`<button type="button" class="pill sm" data-use-color="${color}"${disabled(S.busy)}><i aria-hidden="true" style="display:inline-block;width:16px;height:16px;border-radius:50%;background:${color}"></i>${esc(color)} · Use as main color</button>`).join('')}</div><p class="cnote">Selecting a suggestion records it as an owner choice, not an AI result.</p>`:''}</div>
    <div class="group">${traitSelect('Coat pattern','pattern',t.pattern,PATTERNS,S)}${traitSelect('Coat length','coat',t.coat,{short:'Short',medium:'Medium',long:'Long'},S)}${traitSelect('Eye color','eye',t.eye,EYES,S)}</div>
    <div class="group">${traitSelect('Face shape','face',t.face,{round:'Round & chubby',classic:'Classic',wedge:'Slim wedge'},S)}${traitSelect('Ears','ears',t.ears,{small:'Small & rounded',medium:'Medium',large:'Large & pointed'},S)}${traitSelect('Expression','expression',t.expression,{alert:'Wide-eyed',unimpressed:'Unimpressed',sleepy:'Sleepy'},S)}</div>
    <div class="group"><span class="sublabel">Owner-noted markings</span><p class="cnote">Unchecked means not specified; it is not a claim that the marking is absent.</p><div class="pills">${Object.entries(MARKS).map(([key,label])=>`<label class="pill${t.markings?.[key]?' on':''}"><input type="checkbox" data-marking="${key}"${t.markings?.[key]?' checked':''}${disabled(S.busy)}> ${esc(label)}<small>${esc(origin(S,`markings.${key}`,t.markings?.[key]))}</small></label>`).join('')}</div><label class="field" for="distinctive"><span>Other details an owner would recognize</span><textarea id="distinctive" maxlength="643" aria-describedby="distinctive-help" placeholder="Optional: up to four details, one per line"${disabled(S.busy)}>${esc((t.distinctive || []).join('\n'))}</textarea>${provenance(S,'distinctive',t.distinctive?.length?t.distinctive:null)}</label><p class="cnote" id="distinctive-help">Up to four details, one per line, with 160 characters per detail.</p></div>
    <div class="group"><div class="row">${button('confirm-profile',S.profileConfirmed?'Owner profile confirmed':'Confirm owner-entered profile',{soft:false,unavailable:S.busy})}</div><p class="hint">You can confirm a profile with unknown traits. A main color is needed only if you choose the optional material demo.</p></div>`;
}
function personalityPanel(S) {
  return `<h3>Personality &amp; charms</h3><p class="hint">Describe ${esc(catName(S))} in your own words. These owner choices are saved with the profile; they do not create cat characters or favorite-toy images in this static prototype.</p>
    <div class="group"><span class="sublabel">Choose any that fit</span><div class="pills">${HABITS.map(([id,label])=>`<button type="button" class="pill${S.habits?.includes(id)?' on':''}" data-habit="${id}" aria-pressed="${!!S.habits?.includes(id)}"${disabled(S.busy)}>${esc(label)}</button>`).join('')}</div></div>
    <div class="group field"><label for="favToy">Favorite toy or object</label><input id="favToy" type="text" maxlength="60" placeholder="e.g. feather wand, shrimp plushie, cardboard box" value="${esc(S.favToy)}" autocomplete="off"${disabled(S.busy)}></div>
    <div class="group field"><label for="catNote">Habits in your own words</label><textarea id="catNote" maxlength="600" placeholder="e.g. Sleeps in the laundry basket and chirps at birds."${disabled(S.busy)}>${esc(S.note)}</textarea></div>
    <div class="group"><span class="sublabel">Personalized Jibbitz concepts</span><div class="note est"><b>Personalized character and toy generation unavailable</b>Your photo and profile are recorded for the intended feature. No new cat pose, sculpted character or favorite-toy artwork has been generated. Original sculpted examples are available only through the separate interactive demo and must be added explicitly.</div></div>`;
}
function generationPanel(S) {
  const generation = currentGeneration(S);
  const cards = Object.entries(MODES).map(([mode,[title,description]])=>`<button type="button" class="dir" role="radio" aria-checked="${S.direction===mode}" data-mode="${mode}"${disabled(S.busy)}><span class="dthumb"><span class="sublabel">${S.generations?.[mode]?'Reference demo available':'Concept direction'}</span></span><span class="dtxt"><b>${title}</b><small>${description}</small></span></button>`).join('');
  return `<h3>Choose a direction</h3><p class="hint">Both directions keep the original cream clog, fine short-pile faux-fur upper, removable heel strap cover and physical paw-shaped outsole.</p>
    <div class="dirs" role="radiogroup" aria-label="Design direction">${cards}</div>
    <div class="group"><span class="sublabel">Your personalized concept</span><div class="row">${button('generate','Generate personalized concept',{soft:false,unavailable:S.busy})}</div><p class="cnote">Real image generation is unavailable in this static prototype. This action does not create images, contact a model or switch to a simulation.</p></div>
    ${S.generationNotice?'<div class="note est" id="generationNotice" role="status"><b>Personalized generation unavailable</b>No cat character, Jibbitz or favorite-toy image was generated. Your uploaded photos and owner-entered profile remain unchanged. The interactive demo below is a separate optional action.</div>':''}
    <div class="group"><span class="sublabel">Optional interactive reference demo</span><p class="hint">Explore an owner-color material preview on the original footwear. Sculpted reference examples are an unselected inventory, not generated results or your cat’s character.</p><div class="row">${button('demo-generate',generation?'Refresh interactive demo':'Explore interactive demo',{unavailable:S.busy || !S.photos?.length || !S.profileConfirmed})}</div>${generation?'<div class="note est"><b>Interactive reference demo ready</b>Only the original footwear material preview has been prepared. No reference charm is selected automatically and no personalized image was generated.</div>':''}</div>
    <p class="hint">You can continue with the original footwear without opening the demo.</p>`;
}
function referenceLabel() { return '<span class="src">ORIGINAL SCULPTED REFERENCE EXAMPLE</span>'; }
function referenceNotes(generation) {
  return generation?.referenceNotes?.length ? `<div class="note est"><b>Favorite-object reference limits</b>${generation.referenceNotes.map(note=>`<p>${esc(note)}</p>`).join('')}</div>` : '';
}
function customizePanel(S) {
  const d = S.design || {}, generation = currentGeneration(S), charms = generation?.charms || [];
  const ordered = (d.charms || []).map(id=>charms.find(charm=>charm.id===id)).filter(Boolean);
  const order = ordered.map((charm,index)=>`<li><span class="num">${index+1}</span><span class="ci">${assetImage(charm.asset,`${charm.title} · original sculpted reference example`)}</span><span class="meta">${esc(charm.title)}<small>Original sculpted reference example · ${esc(SLOT_NAMES[index] || 'Additional charm')}</small></span><button type="button" class="ib" data-up="${index}" aria-label="Move reference example earlier"${disabled(index===0 || S.busy)}>↑</button><button type="button" class="ib" data-down="${index}" aria-label="Move reference example later"${disabled(index===ordered.length-1 || S.busy)}>↓</button><button type="button" class="ib" data-remove-charm="${esc(charm.id)}" aria-label="Remove reference example ${esc(charm.title)}"${disabled(S.busy)}>✕</button></li>`).join('');
  const available = charms.filter(charm=>!(d.charms || []).includes(charm.id));
  return `<h3>Make it yours</h3><p class="hint">Adjust the removable pieces and reference-example placement. The original cream base, physical paw tread, strap pivot and ventilation stay protected.</p>
    <div class="note est"><b>${generation?'Optional interactive reference demo':'Original-footwear preview'}</b>No personalized cat character or toy has been generated. Any sculpted examples you add below are original reference artwork, unrelated to the uploaded cat.</div>
    ${referenceNotes(generation)}<div class="group"><span class="sublabel">Direction</span><div class="pills">${Object.entries(MODES).map(([mode,[label]])=>`<button type="button" class="pill${S.direction===mode?' on':''}" data-mode="${mode}" aria-pressed="${S.direction===mode}"${disabled(S.busy)}>${label}</button>`).join('')}</div></div>
    <div class="group"><span class="sublabel">Removable fabric upper</span><div class="switch"><span><b id="upper-label">Fine faux-fur upper ${d.upperOn?'attached':'removed'}</b><small>Fine short-pile fabric covers the vamp above the cream sole line.</small></span><button type="button" class="tog" role="switch" aria-checked="${!!d.upperOn}" aria-labelledby="upper-label" data-action="upper-toggle"${disabled(S.busy)}></button></div></div>
    <div class="group"><span class="sublabel">Removable heel strap cover</span><div class="switch"><span><b id="strap-label">Strap cover ${d.strapOn?'attached':'removed'}</b><small>The original cream pivot and working heel strap remain visible.</small></span><button type="button" class="tog" role="switch" aria-checked="${!!d.strapOn}" aria-labelledby="strap-label" data-action="strap-toggle"${disabled(S.busy)}></button></div>${d.strapOn?`<label class="field" for="strapStyle"><span>Strap material treatment</span><select class="msel" id="strapStyle"${disabled(S.busy)}><option value="match"${selected(d.strapStyle==='match')}>Match the upper</option><option value="accent"${selected(d.strapStyle==='accent')}>Owner-selected eye-color accent</option></select></label>`:''}</div>
    ${generation?`<div class="group field"><label for="scaleIn">Demo material scale · ${Math.round((Number(d.scale)||1)*100)}%</label><input type="range" id="scaleIn" min="0.5" max="2" step="0.05" value="${Math.min(2,Math.max(.5,Number(d.scale)||1))}"${disabled(S.busy)}><p class="hint">Changes the locally composed material preview; no cat markings are inferred.</p></div>`:''}
    <div class="group"><div class="ghead"><span class="sublabel">Selected reference examples · order sets placement</span><span>${ordered.length} selected</span></div>${order?`<ol class="order">${order}</ol>`:'<p class="hint">No charm is selected. Original sculpted examples must be added explicitly.</p>'}
      ${available.length?`<div class="cgrid" id="referenceCharmInventory">${available.map(charm=>`<article class="cc"><div class="cimg">${assetImage(charm.asset,`${charm.title} · original sculpted reference example`)}</div><div class="ctx">${referenceLabel()}<b>${esc(charm.title)}</b><small>This reference artwork was not generated from your photo.</small></div><button type="button" class="pill sm" data-add-charm="${esc(charm.id)}"${disabled(S.busy)}>Add reference example</button></article>`).join('')}</div>`:''}${charms.length?button('restore-charms','Add all reference examples',{unavailable:S.busy}):'<p class="cnote">Open the separate interactive reference demo in Generate to browse original sculpted examples.</p>'}</div>
    <div class="note"><b>Physical outsole stays unchanged</b>Choose Bottom above to see the original paw-shaped tread. It is a footwear design feature, not a charm or a generated surface pattern.</div>`;
}
function reviewPanel(S) {
  const d = S.design || {}, t = S.traits || {}, generation = currentGeneration(S), charms = generation?.charms || [];
  const selectedCharms = (d.charms || []).map(id=>charms.find(charm=>charm.id===id)).filter(Boolean);
  const habits = HABITS.filter(([id])=>S.habits?.includes(id)).map(([,label])=>label).join(', ');
  const text = (value,key) => value ? `${value} · ${origin(S,key,value)}` : 'Not specified';
  const colors = ['main','second','third'].map(key=>validHex(t.colors?.[key])?`${key}: ${t.colors[key]} (${origin(S,`colors.${key}`,t.colors[key])})`:`${key}: Not specified`).join('; ');
  const rows = [
    ['Cat',catName(S)], ['AI analysis',S.aiAnalysis?'Separate analysis record available':'Not performed · unavailable in this static prototype'],
    ['Owner profile',S.profileConfirmed?'Confirmed by owner; unknown traits retained':'Not confirmed'],
    ['Coat pattern',text(PATTERNS[t.pattern], 'pattern')], ['Coat length',text(t.coat,'coat')], ['Coat colors',colors],
    ['Eyes',text(EYES[t.eye]?.[0],'eye')], ['Face shape',text(t.face,'face')], ['Ears',text(t.ears,'ears')],
    ['Expression',text(t.expression,'expression')], ['Direction',MODES[S.direction || 'real'][0]],
    ['Fabric upper',d.upperOn?'Removable fine short-pile faux-fur upper attached':'Removed'],
    ['Heel strap cover',d.strapOn?'Removable wrap attached; original pivot exposed':'Removed'],
    ['Base & outsole','Original cream clog and physical paw-shaped tread preserved'],
    ['Personality',habits || 'Not specified'], ['Favorite thing',S.favToy || 'Not specified'],
    ['Personalized AI images','Not generated'], ['Reference demo',generation?'Owner-color material demo; selected examples remain original reference artwork':'Not opened'],
  ];
  return `<h3>${esc(catName(S))}’s pair</h3><p class="hint">Review your original photo, owner-entered traits and removable footwear parts. This is a school prototype, not an AI-generated product or manufacturing specification.</p>
    <div class="group"><span class="sublabel">Your actual uploaded photo</span><div class="photos">${(S.photos || []).map((photo,index)=>`<div class="photo">${assetImage(photo,`Original uploaded cat photo ${index+1}`)}</div>`).join('')}</div></div>
    <div class="spec"><h4>Profile and design sources</h4><table>${rows.map(([label,value])=>`<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`).join('')}</table></div>
    <div class="spec"><h4>Selected sculpted reference examples <small>${selectedCharms.length} selected</small></h4>${selectedCharms.length?`<div class="tray">${selectedCharms.map(charm=>`<span class="tchip" title="${esc(charm.title)}">${assetImage(charm.asset,`${charm.title} · original reference example`)}</span>`).join('')}</div><ul>${selectedCharms.map(charm=>`<li>${esc(charm.title)} · ORIGINAL SCULPTED REFERENCE EXAMPLE, not personalized</li>`).join('')}</ul>`:'<p>No charms selected. No cat character or favorite-toy image was generated.</p>'}</div>
    <div class="spec" id="outsoleReference"><h4>Original physical paw-shaped outsole</h4><figure style="margin:0"><img src="./a/g-soles.webp" alt="Original underside concept artwork showing the physical paw-shaped tread" loading="lazy"><figcaption class="cnote">Original Bottom-view reference: paw-shaped tread is part of the physical sole. This image is unchanged; no geometry or tread pattern has been generated.</figcaption></figure></div>
    <div class="note ${S.persistenceError?'est':'ai'}" id="saveStatus" role="status" aria-live="polite"><b>${S.persistenceError?'Saving needs attention':S.savedAt?'Design saved':'Saving your design'}</b>${S.persistenceError?'Keep this page open and retry, or download your design before leaving.':S.savedAt?'This owner profile and design are saved locally in this browser. Clearing site data removes the saved copy.':'The design is being saved in this browser. Wait for confirmation, or download a copy before closing the page.'}${S.persistenceError?`<div class="row" style="margin-top:10px">${button('retry-save','Retry saving',{unavailable:S.busy})}</div>`:''}</div>
    <div class="row" style="margin-top:20px">${button('download-json','Download design JSON')}${button('download-html','Download design sheet')}</div><div class="row" style="margin-top:14px">${button('restart','Start a new cat',{unavailable:S.busy})}</div>
    <p class="cnote">Prototype disclaimer: AI recognition and personalized generation are unavailable. Owner inputs, optional image-color suggestions and explicitly chosen reference examples are separate. No order or production request is submitted.</p>`;
}
export function renderPanel(S) {
  const panels = [null,uploadPanel,recognizePanel,personalityPanel,generationPanel,customizePanel,reviewPanel];
  const render = panels[Math.max(1,Math.min(6,Number(S.step)||1))];
  return `<div class="panel">${feedback(S)}${render(S)}</div>`;
}
