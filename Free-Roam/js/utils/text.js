export function cleanDisplayName(value) {
  return String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 32);
}
export function cleanAssetName(value, max = 80) {
  return String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}
