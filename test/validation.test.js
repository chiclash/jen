import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTraits, validatePersonality } from '../server/validation.js';
import { validateConfirmedTraits, createOpenAIProvider } from '../server/openai.js';
import { Jobs } from '../server/jobs.js';
import { manualTraits } from '../frontend/src/state.js';

const traits = {
  pattern: 'bicolor', coat: 'short', colors: {main: '#78787F', second: '#F4F1E9', third: null},
  eye: 'green', expression: 'alert', face: 'round', ears: 'small',
  markings: {white_muzzle: true, mask: false}, distinctive: ['White left cheek'],
  uncertain: ['coat'], summary: 'A gray-and-white cat with a white patch on the left cheek.',
};
const invalidProfiles = () => ({
  'too many identifying details': {...traits, distinctive: ['a', 'b', 'c', 'd', 'e']},
  'overlong identifying detail': {...traits, distinctive: ['a'.repeat(161)]},
  'non-string identifying detail': {...traits, distinctive: [5]},
  'blank identifying detail': {...traits, distinctive: ['   ']},
  'unknown uncertainty': {...traits, uncertain: ['background']},
  'too many uncertainty fields': {...traits, uncertain: Array(9).fill('eye')},
  'empty summary': {...traits, summary: ''},
  'overlong summary': {...traits, summary: 'a'.repeat(601)},
  'non-boolean marking': {...traits, markings: {mask: 'false'}},
  'unknown marking': {...traits, markings: {unknown_mark: true}},
  'absent optional color field': {...traits, colors: {main: '#78787F', second: null}},
});

test('HTTP and provider validation accept the same complete manual/recognized profiles without truncation', () => {
  for (const input of [traits, manualTraits(), {...traits, distinctive: Array(4).fill('a'.repeat(160)), summary: 'a'.repeat(600)}]) {
    assert.deepEqual(validateTraits(input), validateConfirmedTraits(input));
    assert.deepEqual(validateTraits(input), input);
  }
});

test('HTTP validation whitelists profile fields and does not retain arbitrary request metadata', () => {
  const result = validateTraits({...traits, apiKey: 'test-only-metadata', rawResponse: {private: true}});
  assert.deepEqual(result, traits);
  assert.equal(Object.hasOwn(result, 'apiKey'), false);
  assert.equal(Object.hasOwn(result, 'rawResponse'), false);
  result.distinctive.push('new detail');
  result.markings.mask = true;
  assert.deepEqual(traits.distinctive, ['White left cheek']);
  assert.equal(traits.markings.mask, false);
});

test('all invalid profile shapes are rejected at HTTP preflight and by the provider validator', async t => {
  for (const [label, input] of Object.entries(invalidProfiles())) {
    await t.test(label, () => {
      assert.throws(() => validateTraits(input), {code: 'INVALID_PROFILE', status: 422});
      assert.throws(() => validateConfirmedTraits(input), {code: 'INVALID_TRAITS', status: 422});
    });
  }
  assert.throws(() => validateTraits({...traits, is_cat: false}), {code: 'NOT_A_CAT', status: 422});
  assert.throws(() => validateConfirmedTraits({...traits, is_cat: false}), {code: 'NOT_A_CAT', status: 422});
});

test('invalid details never enqueue a job, persist state, or reach a provider', async () => {
  const cat = {id: 'current-cat', revision: 1};
  let providerCalls = 0, writes = 0;
  const store = {
    settled: async () => ({activeCatId: cat.id, cats: {[cat.id]: cat}, generations: {}, identities: {}}),
    update: async () => {writes++;},
  };
  const jobs = new Jobs(store, {generate: async () => {providerCalls++;}});
  for (const input of Object.values(invalidProfiles())) {
    await assert.rejects(jobs.start('session', {catId: cat.id, revision: 1, traits: input, mode: 'real', personality: {}}), {code: 'INVALID_PROFILE', status: 422});
  }
  assert.equal(providerCalls, 0);
  assert.equal(writes, 0);
  assert.equal(jobs.running.size, 0);
});

test('provider prompt uses only the validated profile, not extra caller metadata', async () => {
  let prompt;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const provider = createOpenAIProvider({
    apiKey: 'mock-only', paidRequestsEnabled: true,
    fetchImpl: async (_url, options) => {
      prompt = options.body.get('prompt');
      return new Response(JSON.stringify({data: [{b64_json: png.toString('base64')}]}));
    },
  });
  await provider.generate({photos: [{bytes: png, mimeType: 'image/png'}], traits: {...traits, apiKey: 'metadata-must-not-be-sent'}, mode: 'real', kind: 'face'});
  assert.doesNotMatch(prompt, /apiKey|metadata-must-not-be-sent/);
  assert.match(prompt, /White left cheek/);
});

test('null or array personality is a validation error instead of an internal crash', () => {
  assert.throws(() => validatePersonality(null), {code: 'INVALID_PERSONALITY', status: 422});
  assert.throws(() => validatePersonality([]), {code: 'INVALID_PERSONALITY', status: 422});
});
