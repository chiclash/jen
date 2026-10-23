/*
 * Personalized previews are material composites on the designer's original
 * product photographs. The shoe, sole, vents and branding are not regenerated.
 * This static version composes only explicitly labelled demo materials and
 * owner-selected sculpted reference examples. It never claims AI generation.
 */
const assetUrl = name => new URL(`../a/${name}`, import.meta.url).href;

export const VIEW_CONFIG = Object.freeze({
  side: { width: 1035, height: 480, base: 'p-side.webp', map: 'p-side-map.png', uv: 'p-side-uv.png',
    slots: [[[700, 200, 104], [812, 220, 92], [905, 232, 76], [598, 194, 80]]] },
  top: { width: 885, height: 975, base: 'p-top.webp', map: 'p-top-map.png', uv: 'p-top-uv.png',
    slots: [
      [[176.4, 257.7, 113], [275.9, 262.9, 103], [235.4, 192.8, 97], [108, 315.7, 94]],
      [[707.6, 257.7, 113], [608.1, 262.9, 103], [648.6, 192.8, 97], [776, 315.7, 94]],
    ] },
  back: { width: 278, height: 347, base: 'r2-back-bare.webp', map: 'r2-back-map.png', uv: null, slots: [] },
  detail: { width: 683, height: 1056, base: 'p-close.webp', map: 'p-close-map.png', uv: 'p-close-uv.png',
    slots: [[[384.4, 257.4, 150], [312.5, 338.6, 134], [435.4, 343.6, 128], [214.8, 304.1, 124]]] },
  bottom: { width: 275, height: 262, base: 'g-soles.webp', map: null, uv: null, slots: [] },
});

export function normalizeView(view) {
  const normalized = view === 'close' ? 'detail' : view;
  if (!Object.hasOwn(VIEW_CONFIG, normalized)) throw new Error(`Unsupported footwear view: ${view}`);
  return normalized;
}

function rendererError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Maps encode editable coverage in red, existing fabric shading in green,
// and region identity in blue. Vent openings and their rims remain untouched.
export function maskRegion(red, blue) {
  if (red <= 0 || blue >= 95) return 'protected';
  return blue > 40 && blue < 90 ? 'strap' : 'upper';
}

function sampleTexture(data, width, height, u, v, output) {
  const x = Math.max(0, Math.min(width - 1, u * (width - 1)));
  const y = Math.max(0, Math.min(height - 1, v * (height - 1)));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const ax = x - x0, ay = y - y0;
  for (let channel = 0; channel < 4; channel++) {
    const top = data[(y0 * width + x0) * 4 + channel] * (1 - ax) + data[(y0 * width + x1) * 4 + channel] * ax;
    const bottom = data[(y1 * width + x0) * 4 + channel] * (1 - ax) + data[(y1 * width + x1) * 4 + channel] * ax;
    output[channel] = top * (1 - ay) + bottom * ay;
  }
}

/** Pure pixel compositor: pixels outside the selected material remain exact. */
export function compositeTexturePixels({ base, map, uv = null, texture, width, height,
  textureWidth, textureHeight, upperOn = true, strapOn = true, textureScale = 1, strapTint = null }) {
  if (base.length !== width * height * 4 || map.length !== base.length || (uv && uv.length !== base.length)) {
    throw new Error('Footwear material maps have incompatible dimensions');
  }
  if (textureWidth < 1 || textureHeight < 1 || texture.length !== textureWidth * textureHeight * 4) {
    throw new Error('Generated material has incompatible dimensions');
  }
  const result = new Uint8ClampedArray(base);
  const texel = [0, 0, 0, 0];
  const zoom = Math.max(0.3, Math.min(3, Number(textureScale) || 1));
  const zoomUV = value => {
    const projected = (value - 0.5) / zoom + 0.5;
    return zoom < 1 ? ((projected % 1) + 1) % 1 : Math.max(0, Math.min(1, projected));
  };
  let meanLightness = 0, samples = 0;
  if (strapTint) {
    for (let i = 0; i < texture.length; i += 64) {
      if (texture[i + 3] > 0) { meanLightness += texture[i] * 0.299 + texture[i + 1] * 0.587 + texture[i + 2] * 0.114; samples++; }
    }
    meanLightness = Math.max(1, meanLightness / Math.max(1, samples));
  }
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const region = maskRegion(map[i], map[i + 2]);
    if (region === 'protected' || !base[i + 3] || (region === 'upper' ? !upperOn : !strapOn)) continue;
    // Keep the antialiased boundary of each vent opening unchanged as well.
    const ventEdge = (x > 0 && map[i - 2] > 200) || (x < width - 1 && map[i + 6] > 200)
      || (y > 0 && map[i - width * 4 + 2] > 200) || (y < height - 1 && map[i + width * 4 + 2] > 200);
    if (ventEdge) continue;
    const u = uv ? uv[i] / 255 : x / Math.max(1, width - 1);
    const v = uv ? uv[i + 1] / 255 : 0.42 + y / Math.max(1, height - 1) * 0.18;
    sampleTexture(texture, textureWidth, textureHeight, zoomUV(u), zoomUV(v), texel);
    if (region === 'strap' && strapTint) {
      const luminance = texel[0] * 0.299 + texel[1] * 0.587 + texel[2] * 0.114;
      const lighting = Math.max(0.35, Math.min(1.65, luminance / meanLightness));
      for (let channel = 0; channel < 3; channel++) texel[channel] = strapTint[channel] * lighting;
    }
    const amount = map[i] / 255 * texel[3] / 255;
    const shade = Math.max(0.45, Math.min(1.35, map[i + 1] / 128));
    for (let channel = 0; channel < 3; channel++) {
      result[i + channel] = base[i + channel] + (Math.min(255, texel[channel] * shade) - base[i + channel]) * amount;
    }
    // Alpha remains the original shoe's alpha; texture can never expand it.
  }
  return result;
}

const imageCache = new Map();
const mapCache = new Map();
const renderCache = new Map();
let neutralTexturePromise;

function loadImage(url) {
  if (!imageCache.has(url)) {
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(rendererError('IMAGE_LOAD_FAILED', 'Could not load a personalized artwork asset. Please retry.'));
      image.src = url;
    }).catch(error => { imageCache.delete(url); throw error; });
    imageCache.set(url, promise);
    if (imageCache.size > 40) imageCache.delete(imageCache.keys().next().value);
  }
  return imageCache.get(url);
}

function canvasFor(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.className = 'shoe';
  return canvas;
}

function imagePixels(image, width = image.naturalWidth, height = image.naturalHeight) {
  const canvas = canvasFor(width, height), ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

async function viewAssets(view) {
  if (!mapCache.has(view)) {
    const config = VIEW_CONFIG[view];
    const promise = Promise.all([loadImage(assetUrl(config.base)),
      config.map ? loadImage(assetUrl(config.map)) : null,
      config.uv ? loadImage(assetUrl(config.uv)) : null,
    ]).then(([base, map, uv]) => ({
      base: imagePixels(base, config.width, config.height),
      map: map ? imagePixels(map, config.width, config.height).data : null,
      uv: uv ? imagePixels(uv, config.width, config.height).data : null,
    })).catch(error => { mapCache.delete(view); throw error; });
    mapCache.set(view, promise);
  }
  return mapCache.get(view);
}

function neutralTexture() {
  if (!neutralTexturePromise) {
    neutralTexturePromise = loadImage(assetUrl('fur-tile.png')).then(image => {
      const texture = imagePixels(image);
      for (let i = 0; i < texture.data.length; i += 4) {
        // A restrained short-pile material study, without coarse woolly relief.
        const light = 0.92 + texture.data[i] / 255 * 0.10;
        texture.data[i] = 226 * light;
        texture.data[i + 1] = 217 * light;
        texture.data[i + 2] = 201 * light;
      }
      return texture;
    }).catch(error => { neutralTexturePromise = null; throw error; });
  }
  return neutralTexturePromise;
}

function colorChannels(color) {
  return /^#[0-9a-f]{6}$/i.test(color || '') ? [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16)) : null;
}

export function selectedGenerationCharms(design, generation) {
  const ids = design?.charms || [];
  const charms = generation?.charms || [];
  return ids.map(id => {
    const charm = charms.find(candidate => candidate.id === id);
    if (!charm?.asset?.url) throw rendererError('GENERATED_CHARM_MISSING', 'A selected personalized charm is unavailable. Regenerate it before continuing.');
    return charm;
  });
}

/**
 * Same generated material and charm identities are used in every projection.
 * Rear previews have no front-facing charm slots. The outsole is a fixed photo.
 * No generation gives an explicitly non-AI neutral material preview, without
 * cat art. clogColor is not applied: the designer's cream sole is locked.
 */
async function renderComposition({ view, design = {}, generation, clogColor = null }) {
  view = normalizeView(view);
  const config = VIEW_CONFIG[view], data = await viewAssets(view);
  const canvas = canvasFor(config.width, config.height), ctx = canvas.getContext('2d');
  if (view === 'bottom') {
    ctx.putImageData(data.base, 0, 0);
    return canvas;
  }
  const upperOn = design.upperOn !== false, strapOn = design.strapOn !== false;
  const needsTexture = view === 'back' ? strapOn : upperOn || strapOn;
  if (needsTexture) {
    let texture;
    if (generation) {
      if (!generation.texture?.url) throw rendererError('GENERATION_REQUIRED', 'The personalized material is unavailable. Regenerate the artwork to continue.');
      const image = await loadImage(generation.texture.url);
      const scale = Math.min(1, 768 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      texture = imagePixels(image, width, height);
    } else texture = await neutralTexture();
    const pixels = compositeTexturePixels({ base: data.base.data, map: data.map, uv: data.uv,
      texture: texture.data, width: config.width, height: config.height, textureWidth: texture.width, textureHeight: texture.height,
      upperOn, strapOn, textureScale: design.scale, strapTint: design.strapStyle === 'accent' ? colorChannels(design.accent) : null });
    const output = ctx.createImageData(config.width, config.height);
    output.data.set(pixels);
    ctx.putImageData(output, 0, 0);
  } else ctx.putImageData(data.base, 0, 0);

  // Uploaded/generated charms already have model-provided alpha. Never erase a
  // light background heuristically: that also erases white fur and markings.
  if (generation && config.slots.length) {
    const charms = selectedGenerationCharms(design, generation);
    const images = await Promise.all(charms.map(charm => loadImage(charm.asset.url)));
    ctx.shadowColor = 'rgba(40,30,25,.3)';
    ctx.shadowBlur = Math.max(3, config.width / 180);
    ctx.shadowOffsetY = Math.max(2, config.width / 300);
    for (const slots of config.slots) for (let i = 0; i < Math.min(slots.length, images.length); i++) {
      const image = images[i], [cx, cy, size] = slots[i];
      const scale = size / Math.max(image.naturalWidth, image.naturalHeight);
      const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
      ctx.drawImage(image, cx - width / 2, cy - height / 2, width, height);
    }
  }
  return canvas;
}

export async function renderPersonalizedShoe(options) {
  const { design = {}, generation } = options;
  const view = normalizeView(options.view);
  if (view === 'bottom') {
    // Draw the supplied underside once, directly. No material composition,
    // pixel roundtrip or canvas cache copy may alter even its translucent edges.
    const config = VIEW_CONFIG.bottom;
    const canvas = canvasFor(config.width, config.height);
    canvas.getContext('2d').drawImage(await loadImage(assetUrl(config.base)), 0, 0);
    return canvas;
  }
  const key = JSON.stringify([view, design.upperOn !== false, design.strapOn !== false, design.strapStyle,
    design.accent, design.scale, generation?.id, generation?.texture?.url,
    view === 'bottom' || view === 'back' || !generation ? [] : selectedGenerationCharms(design, generation).map(c => [c.id, c.asset.url])]);
  if (!renderCache.has(key)) {
    const promise = renderComposition({ ...options, view }).catch(error => { renderCache.delete(key); throw error; });
    renderCache.set(key, promise);
    if (renderCache.size > 14) renderCache.delete(renderCache.keys().next().value);
  }
  const original = await renderCache.get(key);
  const copy = canvasFor(original.width, original.height);
  copy.getContext('2d').drawImage(original, 0, 0);
  return copy;
}
