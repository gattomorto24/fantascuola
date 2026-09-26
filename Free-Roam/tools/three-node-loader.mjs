export async function resolve(specifier, context, nextResolve) {
  const vendor = new URL('../vendor/three/', import.meta.url);
  if (specifier === 'three') return { url: new URL('build/three.module.js', vendor).href, shortCircuit: true };
  if (specifier.startsWith('three/addons/')) {
    return { url: new URL(`examples/jsm/${specifier.slice('three/addons/'.length)}`, vendor).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
