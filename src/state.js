/** Browser-only profile state. Uploaded photos, suggestions and owner facts stay separate. */
import { generationInputKey } from './identity.js';

export const MODES = ['real', 'art'];
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const HEX = /^#[0-9a-f]{6}$/i;
const OWNER_SOURCES = new Set(['owner', 'owner-corrected-ai']);
const TRAIT_OPTIONS = {
  pattern:['solid','tabby','calico','tortoiseshell','tuxedo','bicolor','colorpoint','spotted'],
  coat:['short','medium','long'],eye:['copper','gold','green','hazel','blue','odd'],
  expression:['alert','unimpressed','sleepy'],face:['round','classic','wedge'],ears:['small','medium','large'],
};
const MARKINGS = ['white_muzzle','white_bib','dark_ear_tips','forehead_m','eye_patch','nose_spot','mask'];
const NEUTRAL = '#E2D9C9';
export const isAssetUrl = value => typeof value === 'string' && DATA_IMAGE.test(value);

/** Empty fields mean unknown. Neutral rendering values must never become cat facts. */
export function manualTraits() {
  return {pattern:'',coat:'',colors:{main:null,second:null,third:null},eye:'',expression:'',
    face:'',ears:'',markings:{},distinctive:[],
    uncertain:['pattern','coat','colors','eye','expression','face','ears','markings'],
    summary:'No cat traits have been identified. Enter only details you can confirm from your photos.'};
}

export function defaultDesign(traits = manualTraits(), mode = 'real', generation = null) {
  const colors = traits?.colors || {};
  const main = HEX.test(colors.main || '') ? colors.main : NEUTRAL;
  const second = HEX.test(colors.second || '') ? colors.second : main;
  const third = HEX.test(colors.third || '') ? colors.third : main;
  const eyes = {copper:'#C9772B',gold:'#D6A43A',green:'#7DA552',hazel:'#A39445',blue:'#6EA2D6',odd:'#6EA2D6'};
  return {direction:mode,upperOn:true,strapOn:true,strapStyle:'match',scale:1,texture:'fine',
    colors:{base:main,m1:second,m2:third},accent:eyes[traits?.eye] || '#C8BDA8',charms:[]};
}

export function initialState() {
  return {schemaVersion:2,step:1,max:1,name:'',photos:[],cat:null,traits:null,
    aiAnalysis:null,traitSources:{},colorSuggestions:[],generationNotice:false,
    profileConfirmed:false,source:'unconfirmed',sourceNote:'',habits:[],favToy:'',note:'',
    generations:{real:null,art:null},designs:{real:null,art:null},direction:'real',
    design:defaultDesign(),view:'side',busy:false,operation:null,progress:null,error:null,
    aiConfigured:false,paidRequestsEnabled:false,savedAt:null,persistenceError:null};
}

export function stateForCat(cat, capability = {}) {
  const s = initialState();
  s.cat = {id:cat.id,revision:cat.revision};
  s.photos = cat.photos.map(photo => ({id:photo.id,url:photo.url,name:photo.name,width:photo.width,height:photo.height}));
  // An older cat.traits object may contain demo guesses. It is never an analysis receipt.
  s.traits = manualTraits();
  s.view = 'photo';
  s.sourceNote = 'Your photos are uploaded locally. No coat, eye color, face shape or markings have been recognized.';
  s.max = 2;
  s.aiConfigured = Boolean(capability.aiConfigured);
  s.paidRequestsEnabled = Boolean(capability.paidRequestsEnabled);
  return s;
}

export function generationFingerprint(s, mode = s.direction) {
  return generationInputKey({catId:s.cat?.id,revision:s.cat?.revision,traits:s.traits || {},mode,
    personality:{name:s.name,habits:s.habits,favoriteToy:s.favToy,note:s.note}});
}

export function serializeState(s) {
  const keys = ['schemaVersion','step','max','name','photos','cat','traits','aiAnalysis','traitSources',
    'colorSuggestions','generationNotice','profileConfirmed','source','sourceNote','habits','favToy','note',
    'generations','designs','direction','design','view'];
  return JSON.parse(JSON.stringify(Object.fromEntries(keys.map(key => [key,s[key]]))));
}

/** Reject older photo-medallion results, even if their owner/session IDs still match. */
export function isCurrentDemoGeneration(g, cat) {
  const photo = cat?.photos?.[0];
  return Boolean(g && photo && g.prototypeVersion === 2 && g.simulationType === 'material-layout'
    && g.simulated === true && g.catId === cat.id && g.revision === cat.revision && MODES.includes(g.mode)
    && g.character?.id === photo.id && g.character?.url === photo.url
    && g.character?.provenance === 'uploaded-photo' && isAssetUrl(g.character.url)
    && g.texture?.provenance === 'local-material-simulation' && isAssetUrl(g.texture.url)
    && Array.isArray(g.charms) && g.charms.every(charm => charm.provenance === 'reference-example'
      && charm.simulated === true && charm.asset?.provenance === 'reference-example' && isAssetUrl(charm.asset.url)));
}

function ownerProfile(saved) {
  const traits = manualTraits(), sources = {};
  const input = saved.traits || {}, provided = saved.traitSources || {};
  const owner = key => OWNER_SOURCES.has(provided[key]);
  for (const [key, choices] of Object.entries(TRAIT_OPTIONS)) {
    if (owner(key) && (input[key] === '' || choices.includes(input[key]))) {
      traits[key] = input[key]; sources[key] = provided[key];
    }
  }
  for (const key of ['main','second','third']) {
    const name = `colors.${key}`, color = input.colors?.[key];
    if (owner(name) && (color === null || HEX.test(color || ''))) {
      traits.colors[key] = color; sources[name] = provided[name];
    }
  }
  for (const key of MARKINGS) {
    const name = `markings.${key}`;
    if (owner(name) && typeof input.markings?.[key] === 'boolean') {
      traits.markings[key] = input.markings[key]; sources[name] = provided[name];
    }
  }
  if (owner('distinctive') && Array.isArray(input.distinctive)) {
    traits.distinctive = input.distinctive.filter(item => typeof item === 'string').map(item => item.trim().slice(0,160)).filter(Boolean).slice(0,4);
    sources.distinctive = provided.distinctive;
  }
  traits.uncertain = Object.keys(TRAIT_OPTIONS).filter(key => !traits[key]);
  if (!traits.colors.main) traits.uncertain.push('colors');
  if (!Object.keys(traits.markings).length) traits.uncertain.push('markings');
  if (Object.keys(sources).length) traits.summary = 'Profile entered by the owner. Unset fields remain unknown; no AI analysis was performed.';
  return {traits,sources};
}

function restorePersonalDetails(s, saved) {
  s.name = String(saved.name || '').slice(0,60);
  s.favToy = String(saved.favToy || '').slice(0,60);
  s.note = String(saved.note || '').slice(0,600);
  s.habits = Array.isArray(saved.habits) ? saved.habits.filter(item => typeof item === 'string').slice(0,8) : [];
}

export function restoreState(saved, cat, capability = {}) {
  if (!cat?.id || !cat.photos?.length || !cat.photos.every(photo => isAssetUrl(photo.url))) {
    return {...initialState(),...capability};
  }
  const s = stateForCat(cat, capability);
  const sameCat = saved?.cat?.id === cat.id && saved.cat.revision === cat.revision;
  if (!sameCat) return s;
  restorePersonalDetails(s,saved);
  if (saved.schemaVersion !== 2) {
    s.step = 2; s.max = 2; s.view = 'photo';
    s.sourceNote = 'Your photos and personal notes were restored. Earlier prototype trait guesses and previews were cleared because they were not verified. Confirm the correct cat details below.';
    return s;
  }
  const {traits,sources} = ownerProfile(saved);
  s.traits = traits; s.traitSources = sources;
  s.source = Object.keys(sources).length ? 'owner' : 'unconfirmed';
  s.sourceNote = s.source === 'owner' ? 'Your owner-entered corrections were restored. No AI analysis was performed.' : s.sourceNote;
  s.colorSuggestions = Array.isArray(saved.colorSuggestions) ? saved.colorSuggestions.filter(color => HEX.test(color || '')).slice(0,5) : [];
  s.generationNotice = Boolean(saved.generationNotice);
  s.profileConfirmed = saved.profileConfirmed === true;
  s.direction = MODES.includes(saved.direction) ? saved.direction : 'real';
  s.step = Math.max(1,Math.min(6,Number(saved.step) || 2));
  s.max = Math.max(2,Math.min(6,Number(saved.max) || 2));
  s.step = Math.min(s.step,s.max);
  s.generations = Object.fromEntries(MODES.map(mode => {
    const g = saved.generations?.[mode];
    return [mode,isCurrentDemoGeneration(g,cat) && g.inputFingerprint === generationFingerprint(s,mode) ? g : null];
  }));
  s.designs = Object.fromEntries(MODES.map(mode => {
    const savedDesign = saved.designs?.[mode] || (saved.direction === mode ? saved.design : null) || {};
    const design = defaultDesign(s.traits,mode,s.generations[mode]);
    if (typeof savedDesign.upperOn === 'boolean') design.upperOn = savedDesign.upperOn;
    if (typeof savedDesign.strapOn === 'boolean') design.strapOn = savedDesign.strapOn;
    if (['match','accent'].includes(savedDesign.strapStyle)) design.strapStyle = savedDesign.strapStyle;
    design.scale = Math.max(.5,Math.min(2,Number(savedDesign.scale) || 1));
    const ids = new Set(s.generations[mode]?.charms.map(charm => charm.id) || []);
    design.charms = Array.isArray(savedDesign.charms) ? [...new Set(savedDesign.charms.filter(id => ids.has(id)))] : [];
    return [mode,design];
  }));
  s.design = s.designs[s.direction];
  s.view = ['photo','side','top','back','bottom','detail'].includes(saved.view) ? saved.view : 'photo';
  return s;
}
