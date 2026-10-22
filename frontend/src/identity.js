/** Shared canonical identity key: server jobs and browser restoration compare the same inputs. */
export function generationInputKey({ catId, revision, traits = {}, personality = {}, mode }) {
  const color = value => typeof value === 'string' ? value.toLowerCase() : null;
  const markings = Object.keys(traits.markings || {}).filter(key => traits.markings[key] === true).sort();
  return JSON.stringify({ catId, revision, mode, traits: {
    pattern: traits.pattern, coat: traits.coat, eye: traits.eye, expression: traits.expression,
    face: traits.face, ears: traits.ears,
    colors: { main: color(traits.colors?.main), second: color(traits.colors?.second), third: color(traits.colors?.third) },
    markings, distinctive: traits.distinctive || [],
  }, personality: { name: String(personality.name || 'Your cat').slice(0, 60),
    habits: [...(personality.habits || [])].sort(), favoriteToy: String(personality.favoriteToy || ''),
    note: String(personality.note || '') } });
}
