import { test, describe, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';
import { seed } from '../seed/seed.js';
import { db } from '../config/database.js';
import { claimSessionSqlite, releaseSessionSqlite, verifySessionSqlite } from '../config/database.js';

process.env.NODE_ENV = 'test';
process.env.DATA_BACKEND = 'sqlite';

describe('PASCONX LMS - Single Active Session Login Restriction ("One-Device-at-a-Time")', () => {
  before(async () => {
    await seed();
  });

  beforeEach(() => {
    // Clear active sessions before each test for clean test isolation
    if (db && typeof db.prepare === 'function') {
      try {
        db.prepare('DELETE FROM active_login_sessions').run();
      } catch (e) {
        // Table might not exist in mock environments
      }
    }
  });

  test('1. First login on Device A succeeds with 200 and claims session lock', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.token);

    // Verify session lock exists in database
    const session = db.prepare('SELECT * FROM active_login_sessions WHERE user_id = ?').get(res.body.user.id);
    assert.ok(session);
    assert.ok(session.session_id);
    assert.ok(new Date(session.expires_at) > new Date());
  });

  test('2. Second login on Device B while Device A is active returns 409 Conflict', async () => {
    // Device A logs in
    const resA = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });
    assert.equal(resA.status, 200);
    const tokenA = resA.body.token;

    // Device B attempts login with the same valid credentials
    const resB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });

    assert.equal(resB.status, 409);
    assert.equal(resB.body.success, false);
    assert.equal(resB.body.code, 'SESSION_ALREADY_ACTIVE');
    assert.ok(resB.body.message.includes('already logged in on another device'));
    assert.equal(resB.body.token, undefined);

    // Device A must remain fully active and valid
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenA}`);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.email, 'student@pasconx.com');
  });

  test('3. Repeated login attempts from Device B continue returning 409 and do NOT invalidate Device A', async () => {
    // Device A logs in
    const resA = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });
    assert.equal(resA.status, 200);
    const tokenA = resA.body.token;

    // Device B attempts 3 times
    for (let i = 0; i < 3; i++) {
      const resB = await request(app)
        .post('/api/auth/login')
        .send({ email: 'student@pasconx.com', password: 'Student@12345' });

      assert.equal(resB.status, 409);
      assert.equal(resB.body.code, 'SESSION_ALREADY_ACTIVE');
    }

    // Verify Device A is STILL completely active
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenA}`);

    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.email, 'student@pasconx.com');
  });

  test('4. Once Device A logs out, Device B is permitted to log in', async () => {
    // Device A logs in
    const resA = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });
    assert.equal(resA.status, 200);
    const tokenA = resA.body.token;

    // Device A logs out
    const logoutRes = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokenA}`);
    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.success, true);

    // Device B now logs in -> must succeed!
    const resB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });

    assert.equal(resB.status, 200);
    assert.equal(resB.body.success, true);
    assert.ok(resB.body.token);

    // Device A old token is now rejected
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenA}`);
    assert.equal(meRes.status, 401);
  });

  test('5. Stale logout from Device A cannot release Device B session lock', async () => {
    // Device A logs in
    const resA = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });
    const tokenA = resA.body.token;

    // Simulate Device A expiring by manually updating active session to Device B
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('student@pasconx.com');
    db.prepare('DELETE FROM active_login_sessions WHERE user_id = ?').run(user.id);

    // Device B logs in
    const resB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });
    assert.equal(resB.status, 200);
    const tokenB = resB.body.token;

    // Stale Device A attempts to call logout with old token
    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${tokenA}`);

    // Device B must still be fully valid and active!
    const meResB = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenB}`);
    assert.equal(meResB.status, 200);
    assert.equal(meResB.body.user.email, 'student@pasconx.com');
  });

  test('6. Expired session lock automatically allows new device login', async () => {
    // User logs in on Device A
    const resA = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });
    assert.equal(resA.status, 200);

    // Manually backdate the session lock expiry into the past
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('student@pasconx.com');
    db.prepare(`
      UPDATE active_login_sessions 
      SET expires_at = datetime('now', '-1 hour') 
      WHERE user_id = ?
    `).run(user.id);

    // Device B logs in -> should succeed because existing session is expired
    const resB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });

    assert.equal(resB.status, 200);
    assert.equal(resB.body.success, true);
    assert.ok(resB.body.token);
  });

  test('7. Invalid password returns 401, not 409', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'IncorrectPassword' });

    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Invalid email or password.');
  });

  test('8. Disabled account returns 403, not 409', async () => {
    const user = db.prepare('SELECT id FROM users WHERE email = ?').get('student@pasconx.com');
    db.prepare("UPDATE users SET status = 'DISABLED' WHERE id = ?").run(user.id);

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'student@pasconx.com', password: 'Student@12345' });

    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('disabled'));

    // Restore user status
    db.prepare("UPDATE users SET status = 'ACTIVE' WHERE id = ?").run(user.id);
  });

  test('9. Single active session restriction applies equally to ADMIN accounts', async () => {
    // Admin logs in on Device A
    const resA = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@pasconx.com', password: 'Admin@12345' });
    assert.equal(resA.status, 200);
    const tokenA = resA.body.token;

    // Admin attempts login on Device B
    const resB = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@pasconx.com', password: 'Admin@12345' });

    assert.equal(resB.status, 409);
    assert.equal(resB.body.code, 'SESSION_ALREADY_ACTIVE');

    // Admin Device A remains active
    const meRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenA}`);
    assert.equal(meRes.status, 200);
    assert.equal(meRes.body.user.role, 'ADMIN');
  });

  test('10. Simultaneous concurrent login attempts: exactly one succeeds and one receives 409 Conflict', async () => {
    // Fire two concurrent login requests for the same student simultaneously
    const [res1, res2] = await Promise.all([
      request(app)
        .post('/api/auth/login')
        .send({ email: 'student@pasconx.com', password: 'Student@12345' }),
      request(app)
        .post('/api/auth/login')
        .send({ email: 'student@pasconx.com', password: 'Student@12345' })
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409], 'Exactly one login must succeed (200) and one must be rejected (409)');

    const conflictRes = res1.status === 409 ? res1 : res2;
    assert.equal(conflictRes.body.code, 'SESSION_ALREADY_ACTIVE');

    const winnerRes = res1.status === 200 ? res1 : res2;
    assert.equal(winnerRes.body.success, true);
    assert.ok(winnerRes.body.token);
  });
});
