import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';

const repoRoot = resolve(import.meta.dirname, '..');
const backendSpecPath = resolve(repoRoot, '.scratch/deploy/backend-app.yaml');

describe('prepare-do-specs', () => {
  test('rejects placeholder and obviously weak production JWT secrets', () => {
    for (const jwtSecret of [
      'replace-with-at-least-32-random-characters',
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    ]) {
      const result = runPrepareSpecs({ JWT_SECRET: jwtSecret });

      expect(result.status).not.toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).toContain(
        'JWT_SECRET must be a non-placeholder random secret',
      );
    }
  });

  test('rejects invalid backend worker run command', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun run start:worker\nbun run another-command',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'DO_BACKEND_WORKER_RUN_COMMAND must be a single-line value',
    );
  });

  test('rejects invalid backend cron schedules before writing deploy specs', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_CRON_ANALYTICS_SNAPSHOT_SCHEDULE: '0 3 nope * *',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('day-of-month field');
  });

  test('rejects unsupported App Platform instance size slugs', () => {
    const result = runPrepareSpecs({
      DO_API_INSTANCE_SIZE_SLUG: 'expensive-surprise',
    });

    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      'DO_API_INSTANCE_SIZE_SLUG must be one of:',
    );
  });

  test('generates backend worker and default cron job blocks', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_WORKER_NAME: 'notifications',
      DO_BACKEND_WORKER_RUN_COMMAND: 'bun backend/src/worker.ts',
      DO_BACKEND_CRON_ANALYTICS_SNAPSHOT_SCHEDULE: '0 3 * * *',
      DO_BACKEND_CRON_TIME_ZONE: 'Europe/Moscow',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain('workers:');
    expect(spec).toContain('  - name: notifications');
    expect(spec).toContain('run_command: "bun backend/src/worker.ts"');
    expect(spec).toContain('kind: SCHEDULED');
    expect(spec).toContain('run_command: "bun run start:cron -- analytics.snapshot"');
    expect(spec).toContain('run_command: "bun run start:cron -- selection.retention_calibration"');
    expect(spec).toContain('run_command: "bun run start:cron -- okr.quarter_start"');
    expect(spec).toContain('time_zone: "Europe/Moscow"');
    expect(spec).toContain(`    http_port: 8080
    instance_size_slug: apps-s-1vcpu-1gb
    instance_count: 1`);
    expect(spec).not.toContain('REPLACE_WITH_');
  });

  test('generates explicit backend API instance sizing overrides', () => {
    const result = runPrepareSpecs({
      DO_API_INSTANCE_SIZE_SLUG: 'apps-s-1vcpu-2gb',
      DO_API_INSTANCE_COUNT: '2',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).toContain(`    http_port: 8080
    instance_size_slug: apps-s-1vcpu-2gb
    instance_count: 2`);
    expect(spec).not.toContain('REPLACE_WITH_');
  });

  test('can disable backend worker and cron blocks', () => {
    const result = runPrepareSpecs({
      DO_BACKEND_WORKER_ENABLED: 'false',
      DO_BACKEND_CRON_ENABLED: 'false',
    });

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const spec = readFileSync(backendSpecPath, 'utf8');
    expect(spec).not.toContain('workers:');
    expect(spec).not.toContain('kind: SCHEDULED');
  });
});

function runPrepareSpecs(extraEnv = {}) {
  return spawnSync(process.execPath, ['scripts/prepare-do-specs.mjs', 'backend-final'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      DO_PROJECT_SLUG: 'vibecoding-template-test',
      DO_GITHUB_REPO: 'owner/repo',
      DO_GIT_BRANCH: 'main',
      JWT_SECRET: 'abcdefghijklmnopqrstuvwxyz123456',
      DO_WEB_URL: 'https://web.example.com',
      ...extraEnv,
    },
  });
}
