/** Explicitly simulated artwork: original footwear is rendered elsewhere from its original photos. */
const asset = file => new URL(`../a/${file}`, import.meta.url).href;
const canvas = (w, h = w) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rgb = hex => [1, 3, 5].map(i => parseInt((hex || '#8E8C91').slice(i, i + 2), 16));
const eyeColors = { copper:'#C9772B', gold:'#D6A43A', green:'#7DA552', hazel:'#A39445', blue:'#6EA2D6', odd:'#6EA2D6' };
export function loadPicture(url) {
  return new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This photo could not be opened. Try a JPEG, PNG or WebP.')); image.src = url; });
}
export function pictureAsset(c, id = crypto.randomUUID()) {
  return { id, url: c.toDataURL('image/png'), width: c.width, height: c.height, simulated: true };
}
export async function localPhoto(input) {
  const blob = input.blob || input;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || !blob.size || blob.size > 8 * 1024 * 1024) {
    throw new Error('Choose JPEG, PNG or WebP photos no larger than 8 MB each.');
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadPicture(url), scale = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = canvas(Math.max(1, Math.round(img.naturalWidth * scale)), Math.max(1, Math.round(img.naturalHeight * scale)));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return { id: crypto.randomUUID(), url: c.toDataURL('image/webp', .86), width: c.width, height: c.height,
      name: String(input.name || blob.name || 'cat-photo.webp').slice(0, 120) };
  } finally { URL.revokeObjectURL(url); }
}

/** Color sampling only: deliberately not presented as machine vision or cat detection. */
export async function estimateProfile(photos) {
  const image = await loadPicture(photos[0].url), c = canvas(64), x = c.getContext('2d');
  const crop = Math.min(image.naturalWidth, image.naturalHeight) * .7;
  x.drawImage(image, (image.naturalWidth - crop) / 2, (image.naturalHeight - crop) / 2, crop, crop, 0, 0, 64, 64);
  const pixels = x.getImageData(0, 0, 64, 64).data, bins = new Map();
  for (let i = 0; i < pixels.length; i += 16) {
    if (pixels[i + 3] < 128) continue;
    const key = [0, 1, 2].map(k => Math.min(240, Math.round(pixels[i + k] / 32) * 32));
    const hash = key.join(','); const entry = bins.get(hash) || { color: key, count: 0 }; entry.count++; bins.set(hash, entry);
  }
  const colors = [...bins.values()].sort((a, b) => b.count - a.count).slice(0, 3)
    .map(item => '#' + item.color.map(v => v.toString(16).padStart(2, '0')).join(''));
  return { pattern: 'solid', coat: 'short', colors: { main: colors[0] || '#8E8C91', second: colors[1] || null, third: colors[2] || null },
    eye: 'gold', expression: 'alert', face: 'classic', ears: 'medium', markings: {}, distinctive: [],
    uncertain: ['colors', 'pattern', 'eye', 'expression', 'markings', 'coat', 'face', 'ears'],
    summary: 'Prototype recognition demo: colors are sampled locally from the middle of the photo and may include the background. Pattern, eye color and face shape are editable placeholders. No AI analysis was performed.' };
}
function random(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }
export async function materialPreview(traits, mode, variation = 0) {
  const c = canvas(512), x = c.getContext('2d'), tile = await loadPicture(asset('fur-tile.png'));
  x.drawImage(tile, 0, 0, 512, 512);
  const pixels = x.getImageData(0, 0, 512, 512), colors = [traits.colors.main, traits.colors.second || traits.colors.main, traits.colors.third || traits.colors.main].map(rgb);
  for (let y = 0; y < 512; y++) for (let px = 0; px < 512; px++) {
    const i = (y * 512 + px) * 4, u = px / 512, v = y / 512;
    let region = 0;
    if (['tabby', 'spotted'].includes(traits.pattern)) region = Math.sin(u * 37 + Math.sin(v * 12 + variation) * 2) > .55 ? 1 : 0;
    else if (['calico', 'tortoiseshell'].includes(traits.pattern)) region = Math.sin(u * 13 + variation) + Math.cos(v * 17) > .6 ? 1 : Math.sin(u * 23 - v * 10) > .3 ? 2 : 0;
    else if (['bicolor', 'tuxedo', 'colorpoint'].includes(traits.pattern)) region = Math.sin(u * 7 + v * 4 + variation * .4) > .2 ? 0 : 1;
    const light = .66 + pixels.data[i] / 255 * .55;
    for (let k = 0; k < 3; k++) pixels.data[i + k] = colors[region][k] * light;
  }
  x.putImageData(pixels, 0, 0);
  if (mode === 'art') {
    x.globalAlpha = .18; x.strokeStyle = eyeColors[traits.eye] || eyeColors.gold; x.lineWidth = 20;
    for (let i = -2; i < 8; i++) { x.beginPath(); x.moveTo(i * 100, 0); x.bezierCurveTo(i * 100 + 150, 180, i * 100 - 80, 340, i * 100 + 40, 512); x.stroke(); }
    x.globalAlpha = 1;
  }
  const r = random(17 + variation); x.globalAlpha = .12; x.lineWidth = .8;
  for (let i = 0; i < 6000; i++) { const a = r() * 512, b = r() * 512; x.strokeStyle = i % 2 ? '#fff' : '#292427'; x.beginPath(); x.moveTo(a, b); x.lineTo(a + 1.5, b + 3); x.stroke(); }
  return pictureAsset(c);
}
function cover(x, image, box, zoom = 1) {
  const [left, top, width, height] = box, scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom;
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  x.drawImage(image, left + (width - w) / 2, top + (height - h) / 2, w, h);
}
export async function photoKeepsake(photo, traits, mode, kind = 'face', variation = 0) {
  const c = canvas(288), x = c.getContext('2d'), image = await loadPicture(photo.url);
  const accent = eyeColors[traits.eye] || eyeColors.gold;
  x.shadowColor = 'rgba(47,45,44,.24)'; x.shadowBlur = 8; x.shadowOffsetY = 4;
  x.fillStyle = mode === 'art' ? '#DCD5EE' : '#F2E8D5';
  x.beginPath();
  if (kind === 'body') x.roundRect(28, 24, 232, 240, SIZES[traits.face] || 65);
  else x.ellipse(144, 144, traits.face === 'wedge' ? 111 : 126, 126, 0, 0, Math.PI * 2);
  x.fill(); x.shadowBlur = 0; x.shadowOffsetY = 0;
  x.save(); x.beginPath();
  if (kind === 'body') x.roundRect(39, 35, 210, 218, 56);
  else x.ellipse(144, 144, traits.face === 'wedge' ? 100 : 115, 115, 0, 0, Math.PI * 2);
  x.clip(); cover(x, image, [29, 29, 230, 230], 1 + (variation % 3) * .08); x.restore();
  x.strokeStyle = accent; x.lineWidth = mode === 'art' ? 7 : 3;
  x.beginPath(); x.ellipse(144, 144, traits.face === 'wedge' ? 116 : 131, 131, 0, .08, Math.PI * 1.9); x.stroke();
  if (kind === 'sleep') { const moon = await loadPicture(asset('jb/n-moon.webp')); x.drawImage(moon, 186, 186, 84, 84); }
  return pictureAsset(c);
}
const SIZES = { round: 92, classic: 65, wedge: 38 };
export function favoriteArtwork(personality) {
  const options = [[/shrimp|prawn/, 't-shrimp', 'Shrimp'], [/feather|wand|bird/, 't-feather', 'Feather toy'], [/fish|tuna|salmon/, 't-fish', 'Fish'], [/yarn|string|wool/, 't-yarn', 'Yarn ball'], [/mouse|mice/, 't-mouse', 'Mouse toy'], [/ball|pompom/, 't-pompom', 'Pom-pom'], [/milk/, 't-milk', 'Milk'], [/bell/, 't-bell', 'Bell']];
  for (const text of [personality.favoriteToy || '', personality.note || '', (personality.habits || []).join(' ')]) {
    for (const [pattern, file, label] of options) if (pattern.test(text.toLowerCase())) return { file, label };
  }
  return { file: 'n-paw', label: 'Paw keepsake' };
}
export async function toyPreview(personality, mode) {
  const choice = favoriteArtwork(personality), image = await loadPicture(asset(`jb/${choice.file}.webp`));
  const c = canvas(288), x = c.getContext('2d'), size = Math.max(image.naturalWidth, image.naturalHeight), scale = 248 / size;
  x.drawImage(image, (288 - image.naturalWidth * scale) / 2, (288 - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale);
  return { asset: pictureAsset(c), label: choice.label,
    why: `Original ${choice.label.toLowerCase()} reference artwork, selected for this prototype. ${personality.favoriteToy ? 'It stands in for the favorite object you entered.' : 'No favorite object was inferred by AI.'}` };
}
