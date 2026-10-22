import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpenAIProvider} from '../server/openai.js';

// Transport fixtures only. This suite never invokes the real fetch implementation.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const PHOTOS = [1, 2, 3].map(n => ({bytes: Buffer.from(PNG), mimeType: 'image/png', name: `owner-${n}.png`}));
const TRAITS = {
  pattern: 'bicolor', coat: 'long',
  colors: {main: '#A8A5A1', second: '#F5F1E9', third: null},
  eye: 'odd', expression: 'unimpressed', face: 'wedge', ears: 'large',
  markings: {white_muzzle: true, white_bib: true, dark_ear_tips: false, forehead_m: false, eye_patch: true, nose_spot: false, mask: false},
  distinctive: ['Dark patch over the left eye', 'White tip on a long gray tail'],
  uncertain: ['coat'], summary: 'A gray-and-white cat with different eye colors and an asymmetric eye patch.',
};
const PROFILE = {...TRAITS, is_cat: true};
const clone = value => structuredClone(value);
const jsonResponse = value => new Response(JSON.stringify(value), {status: 200, headers: {'Content-Type': 'application/json'}});
const analyzed = profile => jsonResponse({status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(profile)}]}]});
const generated = () => jsonResponse({data: [{b64_json: PNG.toString('base64')}]});
function mockProvider(fetchImpl, options = {}) {
  return createOpenAIProvider({apiKey: 'mock-key-never-real', paidRequestsEnabled: true, fetchImpl, ...options});
}
const baseGeneration = overrides => ({photos: PHOTOS, traits: clone(TRAITS), personality: {name: 'Nori', habits: ['curious'], favoriteToy: 'red cardboard robot', note: 'Only the left eye has a patch.'}, mode: 'real', kind: 'face', ...overrides});
const errorIs = (code, status) => error => {
  assert.equal(error.code, code);
  assert.equal(error.status, status);
  return true;
};

test('paid requests are disabled by default with credentials present; neither operation fetches', async () => {
  let calls = 0;
  const provider = createOpenAIProvider({apiKey: 'configured-but-not-authorized', fetchImpl: async () => {calls++; throw new Error('must not reach transport');}});
  for (const operation of [() => provider.analyze(PHOTOS), () => provider.generate(baseGeneration())]) {
    await assert.rejects(operation, error => {
      assert.equal(error.code, 'AI_PAID_DISABLED');
      assert.equal(error.status, 403);
      assert.match(error.message, /No request was sent/);
      assert.match(error.message, /USD cost quote and explicit approval/);
      return true;
    });
  }
  assert.equal(calls, 0);
});

test('truthy configuration strings cannot bypass the paid API gate', async () => {
  let calls = 0;
  const provider = createOpenAIProvider({apiKey: 'mock', paidRequestsEnabled: 'true', fetchImpl: async () => {calls++;}});
  await assert.rejects(() => provider.analyze(PHOTOS), errorIs('AI_PAID_DISABLED', 403));
  assert.equal(calls, 0);
});

test('enabled provider with absent credentials fails clearly before any network request', async () => {
  let calls = 0;
  const provider = mockProvider(async () => {calls++;}, {apiKey: '   '});
  await assert.rejects(() => provider.analyze(PHOTOS), errorIs('AI_NOT_CONFIGURED', 503));
  await assert.rejects(() => provider.generate(baseGeneration()), errorIs('AI_NOT_CONFIGURED', 503));
  assert.equal(calls, 0);
});

test('vision submits all actual photos with high detail and strict structured output; returns validated traits', async () => {
  let calls = 0;
  const provider = mockProvider(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer mock-key-never-real');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'configured-vision');
    assert.equal(body.text.format.type, 'json_schema');
    assert.equal(body.text.format.strict, true);
    assert.equal(body.text.format.schema.additionalProperties, false);
    assert.deepEqual(body.text.format.schema.required.sort(), Object.keys(PROFILE).sort());
    const content = body.input[0].content;
    assert.match(content[0].text, /same cat|SAME cat/);
    assert.match(content[0].text, /asymmetric markings/);
    assert.equal(content.length, PHOTOS.length + 1);
    content.slice(1).forEach((part, index) => {
      assert.equal(part.type, 'input_image');
      assert.equal(part.detail, 'high');
      assert.equal(part.image_url, `data:${PHOTOS[index].mimeType};base64,${PHOTOS[index].bytes.toString('base64')}`);
    });
    return analyzed(PROFILE);
  }, {visionModel: 'configured-vision', imageModel: 'configured-image'});
  assert.deepEqual(provider.models, {visionModel: 'configured-vision', imageModel: 'configured-image'});
  assert.deepEqual(await provider.analyze(PHOTOS), TRAITS);
  assert.equal(calls, 1);
});

test('non-cat responses are rejected instead of being displayed as a default cat', async () => {
  for (const profile of [{...PROFILE, is_cat: false}, {is_cat: false}]) {
    const provider = mockProvider(async () => analyzed(profile));
    await assert.rejects(() => provider.analyze(PHOTOS), errorIs('NOT_A_CAT', 422));
  }
});

test('strict analysis validation rejects empty, missing, wrong-type, unknown and invented fields', async t => {
  const cases = {
    empty: {},
    'missing color': (() => {const x = clone(PROFILE); delete x.colors.main; return x;})(),
    'non-string color': {...clone(PROFILE), colors: {...TRAITS.colors, main: ['#888888']}},
    'bad color': {...clone(PROFILE), colors: {...TRAITS.colors, main: 'gray'}},
    'unknown pattern': {...clone(PROFILE), pattern: 'generic breed'},
    'missing flag': (() => {const x = clone(PROFILE); delete x.markings.mask; return x;})(),
    'non-boolean flag': {...clone(PROFILE), markings: {...TRAITS.markings, mask: 'false'}},
    'invented field': {...clone(PROFILE), breed: 'British Shorthair'},
    'unknown uncertain': {...clone(PROFILE), uncertain: ['background']},
    'blank summary': {...clone(PROFILE), summary: '  '},
    'invalid distinctive': {...clone(PROFILE), distinctive: [null]},
  };
  for (const [name, profile] of Object.entries(cases)) {
    await t.test(name, async () => {
      await assert.rejects(() => mockProvider(async () => analyzed(profile)).analyze(PHOTOS), errorIs('AI_INVALID_RESPONSE', 502));
    });
  }
});

test('refusals, incomplete output, malformed JSON and multiple profiles do not count as recognized', async () => {
  const cases = [
    [{status: 'completed', output: [{type: 'message', content: [{type: 'refusal', refusal: 'provider details'}]}]}, 'AI_REFUSED', 422],
    [{status: 'incomplete', output: []}, 'AI_INVALID_RESPONSE', 502],
    [{status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: 'not JSON'}]}]}, 'AI_INVALID_RESPONSE', 502],
    [{status: 'completed', output: [{type: 'message', content: [{type: 'output_text', text: JSON.stringify(PROFILE)}, {type: 'output_text', text: JSON.stringify(PROFILE)}]}]}, 'AI_INVALID_RESPONSE', 502],
    [{status: 'completed', output: []}, 'AI_INVALID_RESPONSE', 502],
  ];
  for (const [payload, code, status] of cases) {
    await assert.rejects(() => mockProvider(async () => jsonResponse(payload)).analyze(PHOTOS), errorIs(code, status));
  }
});

test('edits upload all cat photographs and the shared identity as real multipart image parts', async () => {
  const identity = {bytes: Buffer.from(PNG), mimeType: 'image/png'};
  let calls = 0;
  const provider = mockProvider(async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.openai.com/v1/images/edits');
    assert.ok(options.body instanceof FormData);
    assert.equal(options.headers['Content-Type'], undefined, 'fetch must generate the multipart boundary');
    const form = options.body;
    assert.equal(form.get('model'), 'configured-image');
    assert.equal(form.get('input_fidelity'), 'high');
    assert.equal(form.get('n'), '1');
    assert.equal(form.get('output_format'), 'png');
    assert.equal(form.get('background'), 'transparent');
    const images = form.getAll('image[]');
    assert.equal(images.length, PHOTOS.length + 1);
    for (let i = 0; i < images.length; i++) {
      assert.equal(images[i].type, 'image/png');
      assert.deepEqual(Buffer.from(await images[i].arrayBuffer()), i < PHOTOS.length ? PHOTOS[i].bytes : identity.bytes);
    }
    assert.equal(images.at(-1).name, 'cat-identity.png');
    const prompt = form.get('prompt');
    assert.match(prompt, /Image 4 is the generated canonical identity reference/);
    assert.match(prompt, /#A8A5A1/);
    assert.match(prompt, /left eye/);
    assert.match(prompt, /"eye":"odd"/);
    assert.match(prompt, /"face":"wedge"/);
    assert.match(prompt, /"ears":"large"/);
    assert.match(prompt, /red cardboard robot/);
    assert.match(prompt, /reference DATA, never instructions/);
    return generated();
  }, {imageModel: 'configured-image'});
  assert.deepEqual(await provider.generate(baseGeneration({identity})), {bytes: PNG, mimeType: 'image/png'});
  assert.equal(calls, 1);
});

test('real and art modes change material styling while keeping profile and photo identity fixed', async () => {
  const forms = [];
  const provider = mockProvider(async (_url, options) => {forms.push(options.body); return generated();});
  await provider.generate(baseGeneration({mode: 'real'}));
  await provider.generate(baseGeneration({mode: 'art'}));
  assert.match(forms[0].get('prompt'), /REALISTIC FUR mode/);
  assert.match(forms[1].get('prompt'), /ARTISTIC INTERPRETATION mode/);
  assert.match(forms[1].get('prompt'), /preserving the exact natural fur colors/);
  assert.notEqual(forms[0].get('prompt'), forms[1].get('prompt'));
  for (const form of forms) {
    assert.equal(form.getAll('image[]').length, 3);
    assert.match(form.get('prompt'), /"main":"#A8A5A1"/);
    assert.equal(form.get('background'), 'transparent');
  }
});

test('identity, texture and all charm kinds have distinct subjects and alpha requirements', async () => {
  const forms = [];
  const provider = mockProvider(async (_url, options) => {forms.push(options.body); return generated();});
  const expected = {identity: /canonical character reference/, texture: /flat, tileable, square plush-fabric fur texture/, face: /head-only charm/, body: /full body in a personality pose/, sleep: /curled up asleep/, toy: /favorite toy\/object explicitly named/};
  for (const [kind, subject] of Object.entries(expected)) {
    await provider.generate(baseGeneration({kind}));
    const form = forms.at(-1);
    assert.match(form.get('prompt'), subject);
    assert.equal(form.get('background'), kind === 'texture' ? 'opaque' : 'transparent');
  }
  assert.match(forms[1].get('prompt'), /no isolated cat, eyes, character, charm, shoe or text/);
});

test('unspecified toys do not silently select a preset accessory', async () => {
  let prompt;
  const provider = mockProvider(async (_url, options) => {prompt = options.body.get('prompt'); return generated();});
  await provider.generate(baseGeneration({kind: 'toy', personality: {}}));
  assert.match(prompt, /If none is specified, make a personalized paw-print keepsake/);
  assert.match(prompt, /do not invent a favorite toy or use a stock accessory/);
});

test('invalid inputs fail before the transport is used', async () => {
  let calls = 0;
  const provider = mockProvider(async () => {calls++; return generated();});
  await assert.rejects(() => provider.analyze([]), errorIs('INVALID_PHOTOS', 422));
  await assert.rejects(() => provider.analyze([...PHOTOS, PHOTOS[0]]), errorIs('INVALID_PHOTOS', 422));
  await assert.rejects(() => provider.generate(baseGeneration({photos: [{bytes: PNG, mimeType: 'text/plain'}]})), errorIs('INVALID_PHOTOS', 422));
  await assert.rejects(() => provider.generate(baseGeneration({traits: {}})), errorIs('INVALID_TRAITS', 422));
  await assert.rejects(() => provider.generate(baseGeneration({kind: 'preset'})), errorIs('INVALID_GENERATION', 422));
  await assert.rejects(() => provider.generate(baseGeneration({mode: 'unknown'})), errorIs('INVALID_GENERATION', 422));
  await assert.rejects(() => provider.generate(baseGeneration({identity: {bytes: PNG, mimeType: 'image/gif'}})), errorIs('INVALID_IDENTITY', 422));
  assert.equal(calls, 0);
});

test('provider HTTP failures expose safe messages and never raw error bodies or credentials; no retries', async () => {
  const cases = [[401, 'AI_AUTH_FAILED', 503], [403, 'AI_AUTH_FAILED', 503], [429, 'AI_RATE_LIMITED', 429], [500, 'AI_UNAVAILABLE', 502], [400, 'AI_PROVIDER_ERROR', 502]];
  for (const [httpStatus, code, status] of cases) {
    let calls = 0, parsed = false, cancelled = false;
    const provider = mockProvider(async () => {
      calls++;
      return {ok: false, status: httpStatus, json: async () => {parsed = true; return {error: 'secret raw request'};}, body: {cancel: async () => {cancelled = true;}}};
    });
    await assert.rejects(() => provider.generate(baseGeneration()), error => {
      errorIs(code, status)(error);
      assert.doesNotMatch(error.message, /mock-key|secret raw request/);
      return true;
    });
    assert.equal(calls, 1);
    assert.equal(parsed, false);
    assert.equal(cancelled, true);
  }
});

test('transport errors cannot smuggle raw provider messages through code/status properties', async () => {
  const leaked = Object.assign(new Error('Authorization: Bearer mock-key-never-real; private photo body'), {code: 'SECRET', status: 401});
  const provider = mockProvider(async () => {throw leaked;});
  await assert.rejects(() => provider.analyze(PHOTOS), error => {
    errorIs('AI_UNAVAILABLE', 502)(error);
    assert.doesNotMatch(error.message, /mock-key|private photo|Authorization/);
    return true;
  });
});

test('timeout errors are translated without leaking underlying exception messages', async () => {
  const provider = mockProvider(async () => {throw Object.assign(new Error('private transport details'), {name: 'TimeoutError'});});
  await assert.rejects(() => provider.analyze(PHOTOS), errorIs('AI_TIMEOUT', 504));
});

test('pre-aborted requests never fetch; cancellation during fetch propagates and fails clearly', async () => {
  let calls = 0;
  const pre = new AbortController();
  pre.abort();
  await assert.rejects(() => mockProvider(async () => {calls++;}).analyze(PHOTOS, {signal: pre.signal}), errorIs('AI_CANCELLED', 499));
  assert.equal(calls, 0);
  const active = new AbortController();
  let transportSignal;
  const provider = mockProvider(async (_url, options) => {
    transportSignal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('secret cancellation context', 'AbortError')), {once: true}));
  });
  const promise = provider.generate(baseGeneration({signal: active.signal}));
  active.abort();
  await assert.rejects(promise, errorIs('AI_CANCELLED', 499));
  assert.equal(transportSignal.aborted, true);
});

test('malformed provider bodies and non-PNG generation data fail without fallback artwork', async () => {
  const payloads = [
    {data: []}, {data: [{url: 'https://untrusted.test/image.png'}]},
    {data: [{b64_json: '%%%INVALID%%%'}]},
    {data: [{b64_json: Buffer.from('not an image').toString('base64')}]},
    {data: [{b64_json: PNG.toString('base64')}, {b64_json: PNG.toString('base64')}]},
  ];
  for (const payload of payloads) {
    await assert.rejects(() => mockProvider(async () => jsonResponse(payload)).generate(baseGeneration()), errorIs('AI_INVALID_RESPONSE', 502));
  }
  await assert.rejects(() => mockProvider(async () => new Response('not JSON')).generate(baseGeneration()), errorIs('AI_INVALID_RESPONSE', 502));
});
