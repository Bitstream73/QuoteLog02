import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = './tests/noteworthy-configs-api-test.db';

describe('Noteworthy Card Configs API', () => {
  let app, authCookie;

  beforeAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    authCookie = getAuthCookie();
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/noteworthy-configs-api-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/admin/noteworthy-configs', () => {
    it('returns 401 without admin auth', async () => {
      const res = await request(app).get('/api/admin/noteworthy-configs');
      expect(res.status).toBe(401);
    });

    it('returns all 28 default configs', async () => {
      const res = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.configs).toHaveLength(28);
      expect(res.body.collections).toBeDefined();
    });

    it('configs include collection_name via LEFT JOIN', async () => {
      const res = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const first = res.body.configs[0];
      expect(first).toHaveProperty('collection_name');
    });
  });

  describe('PATCH /api/admin/noteworthy-configs/:id', () => {
    it('toggles enabled state', async () => {
      const listRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const configId = listRes.body.configs[0].id;

      const patchRes = await request(app).patch(`/api/admin/noteworthy-configs/${configId}`)
        .set('Cookie', authCookie)
        .send({ enabled: true });
      expect(patchRes.status).toBe(200);
      expect(patchRes.body.success).toBe(true);

      const checkRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const updated = checkRes.body.configs.find(c => c.id === configId);
      expect(updated.enabled).toBe(1);

      // Disable it back
      await request(app).patch(`/api/admin/noteworthy-configs/${configId}`)
        .set('Cookie', authCookie)
        .send({ enabled: false });
    });

    it('updates custom_title', async () => {
      const listRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const configId = listRes.body.configs[0].id;

      await request(app).patch(`/api/admin/noteworthy-configs/${configId}`)
        .set('Cookie', authCookie)
        .send({ custom_title: 'My Custom Title' });

      const checkRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const updated = checkRes.body.configs.find(c => c.id === configId);
      expect(updated.custom_title).toBe('My Custom Title');
    });

    it('returns 404 for non-existent config', async () => {
      const res = await request(app).patch('/api/admin/noteworthy-configs/99999')
        .set('Cookie', authCookie)
        .send({ enabled: true });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/admin/noteworthy-configs/:id', () => {
    it('deletes a config', async () => {
      const listRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const lastConfig = listRes.body.configs[listRes.body.configs.length - 1];

      const delRes = await request(app).delete(`/api/admin/noteworthy-configs/${lastConfig.id}`)
        .set('Cookie', authCookie);
      expect(delRes.status).toBe(200);

      const checkRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      expect(checkRes.body.configs).toHaveLength(27);
    });

    it('returns 404 for non-existent config', async () => {
      const res = await request(app).delete('/api/admin/noteworthy-configs/99999')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('Noteworthy Collections CRUD', () => {
    let collectionId;

    it('POST creates a collection', async () => {
      const res = await request(app).post('/api/admin/noteworthy-collections')
        .set('Cookie', authCookie)
        .send({ name: 'Test Collection', display_order: 1 });
      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      collectionId = res.body.id;
    });

    it('GET lists collections', async () => {
      const res = await request(app).get('/api/admin/noteworthy-collections')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.collections.length).toBeGreaterThanOrEqual(1);
    });

    it('PATCH updates a collection', async () => {
      const res = await request(app).patch(`/api/admin/noteworthy-collections/${collectionId}`)
        .set('Cookie', authCookie)
        .send({ name: 'Updated Collection' });
      expect(res.status).toBe(200);
    });

    it('collection deletion nullifies collection_id on child configs', async () => {
      // Assign a card config to the collection
      const listRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const configId = listRes.body.configs[0].id;

      await request(app).patch(`/api/admin/noteworthy-configs/${configId}`)
        .set('Cookie', authCookie)
        .send({ collection_id: collectionId });

      // Delete collection
      const delRes = await request(app).delete(`/api/admin/noteworthy-collections/${collectionId}`)
        .set('Cookie', authCookie);
      expect(delRes.status).toBe(200);

      // Verify config's collection_id is null
      const checkRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const updated = checkRes.body.configs.find(c => c.id === configId);
      expect(updated.collection_id).toBeNull();
    });
  });

  describe('GET /api/search/noteworthy/evaluated', () => {
    it('returns evaluated cards data', async () => {
      const res = await request(app).get('/api/search/noteworthy/evaluated');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('cards');
      expect(res.body).toHaveProperty('collections');
      expect(res.body).toHaveProperty('pepper_settings');
    });

    it('only returns enabled configs', async () => {
      const res = await request(app).get('/api/search/noteworthy/evaluated');
      // All configs are disabled by default, so cards should be empty
      expect(res.body.cards).toHaveLength(0);
    });

    it('pepper_settings includes all 4 keys', async () => {
      const res = await request(app).get('/api/search/noteworthy/evaluated');
      const ps = res.body.pepper_settings;
      expect(ps).toHaveProperty('noteworthy_pepper_frequency');
      expect(ps).toHaveProperty('noteworthy_pepper_chance');
      expect(ps).toHaveProperty('noteworthy_pick_mode');
      expect(ps).toHaveProperty('noteworthy_reuse_cards');
    });
  });

  describe('GET /api/settings includes pepper settings', () => {
    it('returns pepper setting keys', async () => {
      const res = await request(app).get('/api/settings')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('noteworthy_pepper_frequency');
      expect(res.body).toHaveProperty('noteworthy_pepper_chance');
      expect(res.body).toHaveProperty('noteworthy_pick_mode');
      expect(res.body).toHaveProperty('noteworthy_reuse_cards');
    });
  });
});
