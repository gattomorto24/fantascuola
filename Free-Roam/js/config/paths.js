export const freeRoamBase = new URL('../../', import.meta.url);
export function assetUrl(relativePath) { return new URL(relativePath, freeRoamBase).href; }
