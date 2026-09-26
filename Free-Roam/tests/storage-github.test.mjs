import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageService } from '../js/storage/StorageService.js';

const release = 'https://github.com/gattomorto24/fantascuola/releases/download/free-roam-assets/';

test('avatar e mappa GitHub salvano solo URL e metadati in Supabase', async () => {
  const originalFetch = globalThis.fetch;
  const rows = [];
  const calls = [];
  globalThis.fetch = async (url) => url.includes('api.github.com')
    ? { ok: true, json: async () => ({ assets: [
      { name: 'eroe.glb', size: 1024, state: 'uploaded' },
      { name: 'mondo.glb', size: 2048, state: 'uploaded' },
    ] }) }
    : { ok: true };
  const client = {
    get storage() { throw new Error('Supabase Storage non deve essere usato'); },
    from(table) {
      return { insert(row) {
        rows.push([table, row]);
        return { select() { return { async single() { return { data: row, error: null }; } }; } };
      } };
    },
    async rpc(name, args) { calls.push([name, args]); return { error: null }; },
  };
  try {
    const service = new StorageService(client, 'utente');
    await service.publishAvatar(`${release}eroe.glb`, 'Eroe');
    await service.uploadMap(`${release}mondo.glb`, 'Mondo');
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map(([table]) => table), ['free_roam_avatars', 'free_roam_maps']);
    assert.deepEqual(rows.map(([, row]) => row.storage_path), [null, null]);
    assert.ok(rows.every(([, row]) => row.asset_url.startsWith('https://gattomorto24.github.io/fantascuola/Free-Roam/release-assets/')));
    assert.equal(rows[0][1].file_size, 1024);
    assert.equal(rows[1][1].file_size, 2048);
    assert.deepEqual(calls, [['free_roam_activate_map', { p_map_id: rows[1][1].id }]]);
  } finally { globalThis.fetch = originalFetch; }
});
