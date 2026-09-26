import { settings } from '../config/settings.js';
import { cleanAssetName } from '../utils/text.js';
import { validateGLBFile } from '../assets/GLBLoader.js';

export class StorageService {
  constructor(client, userId) { this.client = client; this.userId = userId; }
  async activeMap() {
    const { data: setting, error: settingError } = await this.client.from('free_roam_settings').select('active_map_id').eq('id', true).maybeSingle();
    if (settingError) throw settingError;
    if (!setting?.active_map_id) return null;
    const { data: map, error } = await this.client.from('free_roam_maps').select('*').eq('id', setting.active_map_id).maybeSingle();
    if (error) throw error;
    return map?.enabled ? map : null;
  }
  async signedUrl(bucket, path) {
    const { data, error } = await this.client.storage.from(bucket).createSignedUrl(path, settings.assets.signedUrlSeconds);
    if (error || !data?.signedUrl) throw error || new Error('URL Storage non disponibile.');
    return data.signedUrl;
  }
  async listMyAvatars() {
    const { data, error } = await this.client.from('free_roam_avatars').select('id,name,storage_path,created_at').eq('owner_id', this.userId).order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }
  async avatarById(id) {
    const { data, error } = await this.client.from('free_roam_avatars').select('id,name,storage_path').eq('id', id).maybeSingle();
    if (error || !data) throw error || new Error('Avatar pubblicato non trovato.');
    return data;
  }
  async publishAvatar(file, name, onStage = () => {}) {
    await validateGLBFile(file, 'avatar');
    const id = crypto.randomUUID();
    const path = `${this.userId}/${id}.glb`;
    onStage('Caricamento avatar nello Storage…');
    const { error: uploadError } = await this.client.storage.from('free-roam-avatars').upload(path, file, { contentType: 'model/gltf-binary', upsert: false });
    if (uploadError) throw uploadError;
    onStage('Salvataggio avatar…');
    const { data, error } = await this.client.from('free_roam_avatars').insert({ id, owner_id: this.userId, name: cleanAssetName(name, 40) || 'Avatar', storage_path: path, file_size: file.size }).select('id,name,storage_path').single();
    if (error) { await this.client.storage.from('free-roam-avatars').remove([path]); throw error; }
    return data;
  }
  async uploadMap(file, name, onStage = () => {}) {
    await validateGLBFile(file, 'map');
    const id = crypto.randomUUID();
    const path = `${this.userId}/${id}.glb`;
    onStage('Caricamento mappa nello Storage…');
    const { error: uploadError } = await this.client.storage.from('free-roam-maps').upload(path, file, { contentType: 'model/gltf-binary', upsert: false });
    if (uploadError) throw uploadError;
    onStage('Salvataggio metadati…');
    const { data, error } = await this.client.from('free_roam_maps').insert({ id, uploaded_by: this.userId, name: cleanAssetName(name) || file.name, file_name: file.name, storage_path: path, file_size: file.size, spawn: settings.world.defaultSpawn }).select('*').single();
    if (error) { await this.client.storage.from('free-roam-maps').remove([path]); throw error; }
    onStage('Attivazione mappa…');
    await this.activateMap(data.id);
    return data;
  }
  async activateMap(id) {
    const { error } = await this.client.rpc('free_roam_activate_map', { p_map_id: id });
    if (error) throw error;
  }
}
