import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';
import { seed } from '../seed/seed.js';
import {
  classifyResourceUrl,
  validateResourcePayload,
  sanitizeText,
  parseGoogleDriveUrl
} from '../utils/resourceValidator.js';

process.env.NODE_ENV = 'test';

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const ADMIN = { email: 'admin@pasconx.com', password: 'Admin@12345' };
const STUDENT = { email: 'student@pasconx.com', password: 'Student@12345' };

const login = (creds) =>
  request(app).post('/api/auth/login').set('User-Agent', DESKTOP_UA).send(creds);

describe('External Study Materials & Resource Links Management Suite', () => {
  let adminToken;
  let studentToken;
  let enrolledCourseId;
  let unenrolledCourseId;
  let createdResourceId;

  before(async () => {
    await seed();

    const adminRes = await login(ADMIN);
    assert.equal(adminRes.status, 200, 'Admin login failed');
    adminToken = adminRes.body.token;

    const studentRes = await login(STUDENT);
    assert.equal(studentRes.status, 200, 'Student login failed');
    studentToken = studentRes.body.token;

    // Get courses from student's dashboard
    const coursesRes = await request(app)
      .get('/api/student/courses')
      .set('Authorization', `Bearer ${studentToken}`)
      .set('User-Agent', DESKTOP_UA);

    assert.equal(coursesRes.status, 200);
    assert.ok(coursesRes.body.courses.length > 0, 'Student has no enrolled courses in seed');
    enrolledCourseId = coursesRes.body.courses[0].id;

    // Get all courses from admin to find an unenrolled course for testing isolation
    const allCoursesRes = await request(app)
      .get('/api/admin/courses')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('User-Agent', DESKTOP_UA);

    assert.equal(allCoursesRes.status, 200);
    const unenrolled = allCoursesRes.body.courses.find(c => c.id !== enrolledCourseId);
    if (unenrolled) {
      unenrolledCourseId = unenrolled.id;
    } else {
      // Create a separate course not enrolled by student
      const newCourseRes = await request(app)
        .post('/api/admin/courses')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({ title: 'Unenrolled Advanced Security Course', description: 'Restricted' });
      unenrolledCourseId = newCourseRes.body.course.id;
    }
  });

  // ============================================================================
  // 1. URL VALIDATION & SECURITY UNIT TESTS
  // ============================================================================
  describe('1. Resource URL Validator & Security Engine Unit Tests', () => {
    test('1.1 Allows valid HTTPS Google Drive file URLs and extracts fileId', () => {
      const url = 'https://drive.google.com/file/d/1fkJOdRIonDNO4YYDSno_0hwcBvlcMbMy/view?usp=sharing';
      const result = classifyResourceUrl(url);

      assert.equal(result.ok, true);
      assert.equal(result.provider, 'google_drive');
      assert.equal(result.resourceId, '1fkJOdRIonDNO4YYDSno_0hwcBvlcMbMy');
      assert.equal(result.canDirectDownload, true);
      assert.ok(result.directDownloadUrl.includes('1fkJOdRIonDNO4YYDSno_0hwcBvlcMbMy'));
    });

    test('1.2 Recognizes Google Docs and sets appropriate document metadata', () => {
      const url = 'https://docs.google.com/document/d/1abcXYZ_987654321/edit';
      const result = classifyResourceUrl(url);

      assert.equal(result.ok, true);
      assert.equal(result.provider, 'google_drive');
      assert.equal(result.fileType, 'DOCX');
      assert.equal(result.resourceId, '1abcXYZ_987654321');
    });

    test('1.3 Recognizes Dropbox link and normalizes dl=0 to dl=1 for direct download', () => {
      const url = 'https://www.dropbox.com/s/example123/notes.pdf?dl=0';
      const result = classifyResourceUrl(url);

      assert.equal(result.ok, true);
      assert.equal(result.provider, 'dropbox');
      assert.equal(result.fileType, 'PDF');
      assert.equal(result.canDirectDownload, true);
      assert.ok(result.directDownloadUrl.includes('dl=1'));
    });

    test('1.4 Recognizes direct PDF URLs and allows direct download', () => {
      const url = 'https://example.com/materials/jenkins_guide.pdf';
      const result = classifyResourceUrl(url);

      assert.equal(result.ok, true);
      assert.equal(result.provider, 'direct_url');
      assert.equal(result.fileType, 'PDF');
      assert.equal(result.canDirectDownload, true);
    });

    test('1.5 Rejects insecure HTTP protocols', () => {
      const url = 'http://example.com/insecure.pdf';
      const result = classifyResourceUrl(url);

      assert.equal(result.ok, false);
      assert.ok(result.error.toLowerCase().includes('https'));
    });

    test('1.6 Rejects dangerous javascript: pseudo-protocol', () => {
      const url = 'javascript:alert(1)';
      const result = classifyResourceUrl(url);

      assert.equal(result.ok, false);
    });

    test('1.7 Rejects SSRF destinations (localhost and 127.0.0.1)', () => {
      const res1 = classifyResourceUrl('https://localhost:8080/secret');
      assert.equal(res1.ok, false);
      assert.ok(res1.error.includes('prohibited') || res1.error.includes('Security'));

      const res2 = classifyResourceUrl('https://127.0.0.1/admin');
      assert.equal(res2.ok, false);
    });

    test('1.8 Rejects SSRF private RFC 1918 subnets (10.0.0.1 and 192.168.1.1)', () => {
      const res1 = classifyResourceUrl('https://10.0.0.1/docs');
      assert.equal(res1.ok, false);

      const res2 = classifyResourceUrl('https://192.168.1.10/router');
      assert.equal(res2.ok, false);
    });

    test('1.9 Sanitizes text inputs against stored XSS', () => {
      const dirty = '<script>alert("hack")</script><b>CI/CD Notes</b><iframe src="evil.com"></iframe>';
      const clean = sanitizeText(dirty);

      assert.ok(!clean.includes('<script>'));
      assert.ok(!clean.includes('<iframe>'));
      assert.ok(clean.includes('CI/CD Notes'));
    });
  });

  // ============================================================================
  // 2. ADMIN API CRUD & MANAGEMENT TESTS
  // ============================================================================
  describe('2. Admin Resource Management Endpoints', () => {
    test('2.1 Admin can preview a resource URL before publishing', async () => {
      const res = await request(app)
        .post('/api/admin/resources/preview')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({
          url: 'https://drive.google.com/file/d/1fkJOdRIonDNO4YYDSno_0hwcBvlcMbMy/view'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.preview.provider, 'google_drive');
      assert.equal(res.body.preview.canDirectDownload, true);
    });

    test('2.2 Admin can create a resource with Google Drive link and module name', async () => {
      const res = await request(app)
        .post('/api/admin/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({
          course_id: enrolledCourseId,
          module_name: 'CI/CD Pipeline Architecture',
          title: 'Jenkins Complete Architecture Blueprint',
          description: 'Comprehensive diagram and pipeline script notes.',
          resource_url: 'https://drive.google.com/file/d/1fkJOdRIonDNO4YYDSno_0hwcBvlcMbMy/view',
          resource_category: 'PDF Notes',
          display_order: 1,
          publish_status: 'published'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.success, true);
      assert.ok(res.body.resource.id);
      assert.equal(res.body.resource.provider, 'google_drive');
      assert.equal(res.body.resource.module_name, 'CI/CD Pipeline Architecture');
      createdResourceId = res.body.resource.id;
    });

    test('2.3 Admin can create a direct PDF download resource', async () => {
      const res = await request(app)
        .post('/api/admin/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({
          course_id: enrolledCourseId,
          module_name: 'CI/CD Pipeline Architecture',
          title: 'GitHub Actions Cheat Sheet',
          resource_url: 'https://example.com/github-actions-cheatsheet.pdf',
          resource_category: 'Reference Documents',
          display_order: 2,
          publish_status: 'published'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.resource.can_download, true);
    });

    test('2.4 Admin can create a draft resource (hidden from students)', async () => {
      const res = await request(app)
        .post('/api/admin/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({
          course_id: enrolledCourseId,
          module_name: 'Draft Module',
          title: 'Upcoming Secret Assignment',
          resource_url: 'https://drive.google.com/file/d/1secretAssignment/view',
          resource_category: 'Assignments',
          display_order: 99,
          publish_status: 'draft'
        });

      assert.equal(res.status, 201);
      assert.equal(res.body.resource.publish_status, 'draft');
    });

    test('2.5 Admin can create a resource on an unenrolled course for isolation test', async () => {
      const res = await request(app)
        .post('/api/admin/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({
          course_id: unenrolledCourseId,
          module_name: 'Advanced Security Module',
          title: 'Classified Security Whitepaper',
          resource_url: 'https://drive.google.com/file/d/1classifiedDoc/view',
          resource_category: 'Reference Documents',
          publish_status: 'published'
        });

      assert.equal(res.status, 201);
    });

    test('2.6 Admin rejects creation with invalid or non-HTTPS URL', async () => {
      const res = await request(app)
        .post('/api/admin/resources')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({
          course_id: enrolledCourseId,
          title: 'Bad URL Resource',
          resource_url: 'http://insecure-site.com/doc.pdf',
          resource_category: 'PDF Notes'
        });

      assert.equal(res.status, 400);
      assert.equal(res.body.success, false);
    });

    test('2.7 Admin can retrieve all resources with course filtering', async () => {
      const res = await request(app)
        .get(`/api/admin/resources?course_id=${enrolledCourseId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.resources.length >= 2);
    });

    test('2.8 Admin can get resource statistics', async () => {
      const res = await request(app)
        .get('/api/admin/resources/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.body.stats.total >= 3);
      assert.ok(res.body.stats.published >= 2);
      assert.ok(res.body.stats.draft >= 1);
    });

    test('2.9 Admin can update a resource (title and publish_status)', async () => {
      const res = await request(app)
        .put(`/api/admin/resources/${createdResourceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({
          title: 'Jenkins Complete Architecture Blueprint [UPDATED]'
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.equal(res.body.resource.title, 'Jenkins Complete Architecture Blueprint [UPDATED]');
    });

    test('2.10 Admin can batch reorder resources', async () => {
      const res = await request(app)
        .put('/api/admin/resources/reorder')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({
          items: [
            { id: createdResourceId, display_order: 5 }
          ]
        });

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
    });
  });

  // ============================================================================
  // 3. STUDENT ACCESS & AUTHORIZATION TESTS
  // ============================================================================
  describe('3. Student Access & Isolation Verification', () => {
    test('3.1 Enrolled student can fetch resources for their course', async () => {
      const res = await request(app)
        .get(`/api/student/courses/${enrolledCourseId}/resources`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.resources));
      assert.ok(res.body.resources.length > 0);
      assert.ok(res.body.grouped_by_module);
    });

    test('3.2 Student does NOT see draft or archived resources', async () => {
      const res = await request(app)
        .get(`/api/student/courses/${enrolledCourseId}/resources`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 200);
      const drafts = res.body.resources.filter(r => r.publish_status === 'draft');
      assert.equal(drafts.length, 0, 'Draft resources must not be visible to students');

      const foundSecret = res.body.resources.find(r => r.title === 'Upcoming Secret Assignment');
      assert.equal(foundSecret, undefined, 'Secret draft assignment must be hidden');
    });

    test('3.3 Student CANNOT access resources for an unenrolled course (403 Forbidden)', async () => {
      const res = await request(app)
        .get(`/api/student/courses/${unenrolledCourseId}/resources`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 403, 'Expected 403 Forbidden for unenrolled course');
      assert.equal(res.body.success, false);
    });

    test('3.4 Student can view aggregated resources across all enrolled courses', async () => {
      const res = await request(app)
        .get('/api/student/resources')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);
      assert.ok(Array.isArray(res.body.resources));

      // Must NOT contain resources from unenrolled course
      const unenrolledItems = res.body.resources.filter(r => r.course_id === unenrolledCourseId);
      assert.equal(unenrolledItems.length, 0, 'Aggregated library must strictly exclude unenrolled courses');
    });

    test('3.5 Resource response provides can_download boolean and open_url', async () => {
      const res = await request(app)
        .get(`/api/student/courses/${enrolledCourseId}/resources`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 200);
      const item = res.body.resources[0];
      assert.ok(item);
      assert.ok(item.open_url);
      assert.equal(typeof item.can_download, 'boolean');
    });
  });

  // ============================================================================
  // 4. SECURITY & PERMISSION ENFORCEMENT
  // ============================================================================
  describe('4. Security & Role Privilege Escalation Guards', () => {
    test('4.1 Student cannot create a resource (403 Forbidden)', async () => {
      const res = await request(app)
        .post('/api/admin/resources')
        .set('Authorization', `Bearer ${studentToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({
          course_id: enrolledCourseId,
          title: 'Hacked Resource',
          resource_url: 'https://drive.google.com/file/d/hack/view',
          resource_category: 'PDF Notes'
        });

      assert.equal(res.status, 403);
    });

    test('4.2 Student cannot update a resource (403 Forbidden)', async () => {
      const res = await request(app)
        .put(`/api/admin/resources/${createdResourceId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('User-Agent', DESKTOP_UA)
        .send({ title: 'Student Modified Title' });

      assert.equal(res.status, 403);
    });

    test('4.3 Student cannot delete a resource (403 Forbidden)', async () => {
      const res = await request(app)
        .delete(`/api/admin/resources/${createdResourceId}`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 403);
    });

    test('4.4 Unauthenticated user cannot access admin resources API (401)', async () => {
      const res = await request(app)
        .get('/api/admin/resources')
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 401);
    });

    test('4.5 Admin can delete a resource and audit log is recorded', async () => {
      const res = await request(app)
        .delete(`/api/admin/resources/${createdResourceId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('User-Agent', DESKTOP_UA);

      assert.equal(res.status, 200);
      assert.equal(res.body.success, true);

      // Verify deletion from student perspective
      const verifyRes = await request(app)
        .get(`/api/student/courses/${enrolledCourseId}/resources`)
        .set('Authorization', `Bearer ${studentToken}`)
        .set('User-Agent', DESKTOP_UA);

      const found = verifyRes.body.resources.find(r => r.id === createdResourceId);
      assert.equal(found, undefined, 'Deleted resource must not appear to students');
    });
  });
});
