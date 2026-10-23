/** Local material-layout tools. They never recognize a cat or generate a new character. */
const assetUrl = file => new URL(`../a/${file}`, import.meta.url).href;
const canvas = (w,h=w) => {const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
const HEX = /^#[0-9a-f]{6}$/i;
const NEUTRAL = '#E2D9C9';
const rgb = color => [1,3,5].map(i=>parseInt((HEX.test(color || '') ? color : NEUTRAL).slice(i,i+2),16));
const eyes = {copper:'#C9772B',gold:'#D6A43A',green:'#7DA552',hazel:'#A39445',blue:'#6EA2D6',odd:'#6EA2D6'};
export function loadPicture(url) {
  return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);
    image.onerror=()=>reject(new Error('This photo could not be opened. Try a JPEG, PNG or WebP.'));image.src=url;});
}
export function pictureAsset(c,id=crypto.randomUUID(),provenance='local-material-simulation') {
  return {id,url:c.toDataURL('image/png'),width:c.width,height:c.height,simulated:true,provenance};
}
export async function localPhoto(input) {
  const blob=input.blob || input;
  if (!['image/jpeg','image/png','image/webp'].includes(blob.type) || !blob.size || blob.size>8*1024*1024) {
    throw new Error('Choose JPEG, PNG or WebP photos no larger than 8 MB each.');
  }
  const url=URL.createObjectURL(blob);
  try {
    const image=await loadPicture(url),scale=Math.min(1,1200/Math.max(image.naturalWidth,image.naturalHeight));
    const c=canvas(Math.max(1,Math.round(image.naturalWidth*scale)),Math.max(1,Math.round(image.naturalHeight*scale)));
    c.getContext('2d').drawImage(image,0,0,c.width,c.height);
    return {id:crypto.randomUUID(),url:c.toDataURL('image/webp',.86),width:c.width,height:c.height,
      name:String(input.name || blob.name || 'cat-photo.webp').slice(0,120),provenance:'uploaded-photo'};
  } finally {URL.revokeObjectURL(url);}
}

/** Palette suggestions only. No pattern, coat, eye, face or marking field is inferred. */
export async function estimateColors(photos) {
  if (!Array.isArray(photos) || !photos.length) throw new Error('Choose a cat photo before sampling colors.');
  const c=canvas(64),x=c.getContext('2d'),bins=new Map();
  for (const photo of photos.slice(0,3)) {
    const image=await loadPicture(photo.url),crop=Math.min(image.naturalWidth,image.naturalHeight)*.7;
    x.clearRect(0,0,64,64);
    x.drawImage(image,(image.naturalWidth-crop)/2,(image.naturalHeight-crop)/2,crop,crop,0,0,64,64);
    const pixels=x.getImageData(0,0,64,64).data;
    for (let i=0;i<pixels.length;i+=16) {
      if (pixels[i+3]<128) continue;
      const color=[0,1,2].map(k=>Math.min(255,Math.round(pixels[i+k]/24)*24));
      const key=color.join(','),entry=bins.get(key) || {color,count:0};entry.count++;bins.set(key,entry);
    }
  }
  return [...bins.values()].sort((a,b)=>b.count-a.count).slice(0,5)
    .map(item=>'#'+item.color.map(v=>v.toString(16).padStart(2,'0')).join(''));
}
function random(seed) {return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}

/** Fine short fibers on owner-selected colors, independent of the cat's unknown coat length. */
export async function materialPreview(traits={},mode='real',variation=0) {
  const c=canvas(512),x=c.getContext('2d'),provided=traits.colors || {};
  const main=HEX.test(provided.main || '') ? provided.main : NEUTRAL;
  const palette=[main,HEX.test(provided.second || '') ? provided.second : main,HEX.test(provided.third || '') ? provided.third : main].map(rgb);
  const pixels=x.createImageData(512,512),noise=random(97+variation*11);
  for (let y=0;y<512;y++) for (let px=0;px<512;px++) {
    const i=(y*512+px)*4,u=px/512,v=y/512;
    let region=0;
    if (['tabby','spotted'].includes(traits.pattern)) region=Math.sin(u*25+Math.sin(v*8+variation*.1)*1.5)>.65 ? 1 : 0;
    else if (['calico','tortoiseshell'].includes(traits.pattern)) region=Math.sin(u*11+variation*.1)+Math.cos(v*13)>.7 ? 1 : Math.sin(u*17-v*11)>.5 ? 2 : 0;
    else if (['bicolor','tuxedo','colorpoint'].includes(traits.pattern)) region=Math.sin(u*7+v*3+variation*.06)>.3 ? 0 : 1;
    const light=.985+noise()*.03;
    for (let k=0;k<3;k++) pixels.data[i+k]=palette[region][k]*light;
    pixels.data[i+3]=255;
  }
  x.putImageData(pixels,0,0);
  // Tiny straight fibers add a restrained short-pile finish, never loops or curled bouclé.
  const r=random(17+variation*23);
  x.lineCap='round';
  for (let i=0;i<22000;i++) {
    const left=r()*512,top=r()*512,length=.7+r()*1.7;
    x.strokeStyle=i%2 ? 'rgba(255,255,255,.075)' : 'rgba(47,45,44,.045)';
    x.lineWidth=.3+r()*.25;x.beginPath();x.moveTo(left,top);x.lineTo(left+(r()-.5)*.45,top+length);x.stroke();
  }
  if (mode==='art' && eyes[traits.eye]) {
    x.fillStyle=eyes[traits.eye];x.globalAlpha=.035;x.fillRect(0,0,512,512);x.globalAlpha=1;
  }
  return pictureAsset(c);
}

export function favoriteArtwork(personality={}) {
  const options=[[/shrimp|prawn/,'t-shrimp','Shrimp'],[/feather|wand|bird/,'t-feather','Feather toy'],[/fish|tuna|salmon/,'t-fish','Fish'],[/yarn|string|wool/,'t-yarn','Yarn ball'],[/mouse|mice/,'t-mouse','Mouse toy'],[/ball|pompom/,'t-pompom','Pom-pom'],[/milk/,'t-milk','Milk'],[/bell/,'t-bell','Bell']];
  const explicit=String(personality.favoriteToy || '').trim();
  const find=(text,source)=>{
    for (const [pattern,file,label] of options) if (pattern.test(text.toLowerCase())) return {file,label,source,matched:true};
    return null;
  };
  if (explicit) return find(explicit,'favoriteToy') || {file:null,label:'Favorite object has no reference example',source:'favoriteToy',matched:false,requested:explicit};
  const note=find(String(personality.note || ''),'note');
  if (note) return note;
  const habits=find((personality.habits || []).join(' '),'habits');
  return habits || {file:'n-paw',label:'Paw keepsake',source:'none',matched:false};
}
async function referencePicture(file) {
  const image=await loadPicture(assetUrl(file)),c=canvas(image.naturalWidth,image.naturalHeight);
  c.getContext('2d').drawImage(image,0,0);
  return pictureAsset(c,crypto.randomUUID(),'reference-example');
}
export async function toyPreview(personality={}) {
  const choice=favoriteArtwork(personality);
  if (choice.source==='none') return {asset:null,label:'No favorite object specified',available:false,
    why:'No favorite object was specified. The prototype does not infer or invent a personalized toy.'};
  if (!choice.file) return {asset:null,label:choice.label,available:false,
    why:`There is no original reference illustration for “${choice.requested}”. No replacement toy was invented or personalized.`};
  return {asset:await referencePicture(`jb/${choice.file}.webp`),label:choice.label,available:true,
    why:`Original ${choice.label.toLowerCase()} reference artwork only. It is not a new or personalized sculpt of the owner's object.`};
}
export async function referenceCharm(kind,personality={}) {
  if (kind==='toy') return toyPreview(personality);
  const examples={face:['j-face.webp','Cat-face'],sleep:['j-sleep.webp','Sleeping-cat'],paw:['j-paw.webp','Paw']};
  const entry=examples[kind];
  if (!entry) throw new Error('That reference example is not available.');
  return {asset:await referencePicture(entry[0]),label:entry[1],available:true,
    why:'Original sculpted reference artwork. This example is not generated from, or matched to, the uploaded cat.'};
}
