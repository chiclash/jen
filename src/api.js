/** Browser-local material-layout adapter. Real AI actions always fail honestly. */
import {readLocal,updateLocal,storageWarning} from './local-store.js';
import {localPhoto,estimateColors as sampleColors,materialPreview,referenceCharm} from './demo-art.js';
import {generationInputKey} from './identity.js';
import {isCurrentDemoGeneration} from './state.js';

export class ApiError extends Error {
  constructor(message,{code='DEMO_ERROR',status=0}={}) {super(message);this.code=code;this.status=status;}
}
const jobs=new Map();
const clone=value=>structuredClone(value);
const capability={demo:true,aiConfigured:false,paidRequestsEnabled:false,prototypeVersion:2};
const checkSignal=signal=>{if(signal?.aborted) throw new ApiError('Prototype action cancelled.',{code:'CANCELLED'});};
function pause(ms,signal) {
  return new Promise((resolve,reject)=>{
    checkSignal(signal);const timer=setTimeout(done,ms);
    function done(){signal?.removeEventListener('abort',abort);resolve();}
    function abort(){clearTimeout(timer);reject(new ApiError('Prototype action cancelled.',{code:'CANCELLED'}));}
    signal?.addEventListener('abort',abort,{once:true});
  });
}
function cancelAll() {
  for(const job of jobs.values()) if(['queued','running'].includes(job.status)) {
    job.controller.abort();job.status='cancelled';
  }
}
function currentCat(record,id,revision) {
  if(!record.cat || record.cat.id!==id || (revision!==undefined && record.cat.revision!==revision)) {
    throw new ApiError('These photos belong to an earlier cat. Use the current upload before continuing.',{code:'STALE_CAT'});
  }
  return record.cat;
}
function publicJob(job){const{controller,...view}=job;return clone(view);}
function unavailableAI() {
  throw new ApiError('AI recognition and image generation are not connected in this free prototype. Your uploaded photo and owner-entered details have not been changed.',{code:'AI_DISABLED',status:503});
}
export const api={
  async health(){return{ok:true,...capability};},
  async session(){
    const record=await readLocal();
    return{...capability,state:record.state,cat:record.cat,
      generations:Object.values(record.generations).filter(g=>isCurrentDemoGeneration(g,record.cat)),
      activeJob:null,lastJob:null,storageWarning:storageWarning()};
  },
  async saveSession(state){
    if(!state || state.schemaVersion!==2) throw new ApiError('This saved design needs the current profile format. Reopen the page to migrate it.',{code:'PROFILE_MIGRATION_REQUIRED'});
    await updateLocal(record=>{
      if(state.cat) currentCat(record,state.cat.id,state.cat.revision);
      else if(record.cat) throw new ApiError('Save the current cat rather than an earlier empty state.',{code:'STALE_CAT'});
      record.state=clone(state);
    });
    if(storageWarning()) throw new ApiError(storageWarning(),{code:'LOCAL_SAVE_UNAVAILABLE'});
    return{saved:true,local:true};
  },
  async clearSession(){
    cancelAll();await updateLocal(record=>{record.cat=null;record.state=null;record.generations={};record.variation={};record.identity=null;record.identitySignature=null;});
    return{cleared:true};
  },
  async uploadCat(files,{signal}={}){
    const list=Array.from(files||[]);
    if(!list.length||list.length>3) throw new ApiError('Choose one to three photos.',{code:'INVALID_PHOTOS'});
    const photos=[];
    for(const file of list){checkSignal(signal);photos.push(await localPhoto(file));}
    checkSignal(signal);cancelAll();
    const cat={id:crypto.randomUUID(),revision:1,photos,traits:null};
    await updateLocal(record=>{checkSignal(signal);record.cat=cat;record.state=null;record.generations={};record.variation={};record.identity=null;record.identitySignature=null;});
    return clone(cat);
  },
  async analyzeCat(){return unavailableAI();},
  async startGeneration(){return unavailableAI();},
  async estimateColors(id,{signal}={}){
    checkSignal(signal);const record=await readLocal(),cat=currentCat(record,id);
    const colors=await sampleColors(cat.photos);checkSignal(signal);
    currentCat(await readLocal(),id,cat.revision);
    // Palette suggestions never overwrite profile facts, corrections, or confirmation.
    return{catId:id,revision:cat.revision,colors,simulated:true,method:'local-color-sampling',
      note:'Color suggestions may include the background. No coat, eye color, face shape or markings were analyzed.'};
  },
  async startDemoGeneration(request,{signal}={}){
    checkSignal(signal);const record=await readLocal(),cat=currentCat(record,request.catId,request.revision);
    if(!['real','art'].includes(request.mode)) throw new ApiError('Choose a material-preview direction.',{code:'INVALID_MODE'});
    if(!request.traits || typeof request.traits!=='object') throw new ApiError('Review the owner-entered profile before previewing the materials.',{code:'INVALID_PROFILE'});
    if(!/^#[0-9a-f]{6}$/i.test(request.traits.colors?.main || '')) throw new ApiError('Choose the main fur color yourself before opening the material demo. No fur color has been recognized.',{code:'COLOR_REQUIRED'});
    const previous=record.generations[request.mode];
    if(request.regenerateCharmId && (!isCurrentDemoGeneration(previous,cat)||!previous.charms.some(charm=>charm.id===request.regenerateCharmId))) {
      throw new ApiError('That reference example is no longer available. Preview the material layout again.',{code:'REFERENCE_NOT_FOUND'});
    }
    if(request.regenerateCharmId && previous.inputFingerprint!==generationInputKey(request)) {
      throw new ApiError('The owner-entered details changed. Preview this material layout again before selecting its reference examples.',{code:'PROFILE_CHANGED'});
    }
    cancelAll();
    const job={id:crypto.randomUUID(),catId:cat.id,revision:cat.revision,mode:request.mode,
      inputFingerprint:generationInputKey(request),status:'queued',simulated:true,
      progress:{completed:0,total:request.regenerateCharmId?1:6,label:'Preparing a local material-layout preview'},controller:new AbortController()};
    jobs.set(job.id,job);
    runDemo(job,clone(request)).catch(error=>{
      job.status=job.controller.signal.aborted?'cancelled':'failed';
      job.error={code:error.code||'DEMO_FAILED',message:error.message||'The local preview could not be prepared.'};
    });
    if(jobs.size>20) for(const[id,old]of jobs) if(!['queued','running'].includes(old.status)&&jobs.size>12) jobs.delete(id);
    return{jobId:job.id};
  },
  async job(id){const job=jobs.get(id);if(!job)throw new ApiError('The local preview was interrupted. Run the material preview again.',{code:'DEMO_INTERRUPTED'});return publicJob(job);},
  async cancelJob(id){
    const job=jobs.get(id);
    if(job&&['queued','running'].includes(job.status)){job.controller.abort();job.status='cancelled';}
    return job?publicJob(job):{status:'cancelled'};
  },
};
async function runDemo(job,request){
  job.status='running';const signal=job.controller.signal;
  const record=await readLocal(),cat=currentCat(record,job.catId,job.revision);
  const previous=record.generations[job.mode],variation=(record.variation[job.mode]||0)+1;
  const step=async(label,make)=>{
    checkSignal(signal);currentCat(await readLocal(),job.catId,job.revision);
    job.progress.label=label;await pause(0,signal);
    const value=await make();checkSignal(signal);job.progress.completed++;return value;
  };
  if(request.regenerateCharmId){
    const result=await step('Keeping the same original reference artwork; no new sculpt is created',()=>clone(previous));
    result.referenceNotice='This original reference example was retained. No AI image or new personalized sculpt was generated.';
    job.result=result;job.status='complete';job.progress.label='Original reference example unchanged';return;
  }
  // The identity preview is the actual uploaded image: same photo ID and pixels in both modes.
  const character=await step('Keeping the original uploaded photo unchanged',()=>({...cat.photos[0],provenance:'uploaded-photo',simulated:false}));
  const texture=await step('Composing a fine short-pile material swatch from the chosen colors',()=>materialPreview(request.traits,job.mode,variation));
  const charms=[],referenceNotes=[];
  for(const kind of ['face','sleep','toy','paw']){
    const example=await step('Loading original reference artwork; not a personalized result',()=>referenceCharm(kind,request.personality||{}));
    if(!example.asset){referenceNotes.push(example.why);continue;}
    charms.push({id:crypto.randomUUID(),kind,title:`${example.label} reference example · not personalized`,
      why:example.why,material:'Original sculpted reference artwork',asset:example.asset,
      provenance:'reference-example',simulated:true});
  }
  const result={id:crypto.randomUUID(),catId:cat.id,revision:cat.revision,mode:job.mode,prototypeVersion:2,
    simulationType:'material-layout',character,texture,charms,referenceNotes,
    createdAt:new Date().toISOString(),inputFingerprint:generationInputKey(request),
    model:'Browser-only material-layout prototype; no AI or new sculpt',simulated:true};
  checkSignal(signal);
  await updateLocal(current=>{
    checkSignal(signal);currentCat(current,cat.id,cat.revision);
    // Do not replace raw uploads or stored analysis with rendering/profile corrections.
    current.generations[job.mode]=result;current.variation[job.mode]=variation;
  });
  job.result=result;job.status='complete';job.progress.completed=job.progress.total;
  job.progress.label='Local material layout ready; reference examples require explicit selection';
}
export async function pollGeneration(id,{signal,onProgress}={}){
  try{
    while(true){
      checkSignal(signal);const job=await api.job(id);onProgress?.(job);
      if(job.status==='complete')return job.result;
      if(job.status==='failed'||job.status==='cancelled')throw new ApiError(job.error?.message||'Prototype action cancelled.',{code:job.error?.code||'CANCELLED'});
      await pause(100,signal);
    }
  }catch(error){if(signal?.aborted)await api.cancelJob(id);throw error;}
}
export function downloadFile({filename,data,type='application/octet-stream'}){
  const url=URL.createObjectURL(new Blob([data],{type})),link=document.createElement('a');
  link.href=url;link.download=filename.replace(/[\\/\u0000-\u001f]/g,'_');document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
