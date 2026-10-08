import { describe, expect, it } from 'vitest';
import { bearer, clientIp, readJson, sleep } from './http.ts';

const req = (headers: Record<string, string>, body?: string) => new Request('https://x.test', { method: body === undefined ? 'GET' : 'POST', headers, ...(body === undefined ? {} : { body }) });

describe('briques HTTP', () => {
  it('IP client : premier saut, puis Cloudflare, sinon null', () => {
    expect(clientIp(req({ 'x-forwarded-for': ' 203.0.113.7 , 10.0.0.1' }))).toBe('203.0.113.7');
    expect(clientIp(req({ 'cf-connecting-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(clientIp(req({}))).toBeNull();
  });
  it('jeton Bearer au format JWT seulement', () => {
    expect(bearer(req({ authorization: 'Bearer a.b.c' }))).toBe('a.b.c');
    expect(bearer(req({ authorization: 'Bearer abc' }))).toBeNull();
    expect(bearer(req({}))).toBeNull();
  });
  it('corps JSON borné', async () => {
    expect(await readJson(req({ 'content-type': 'text/plain' }, '{}'), 10)).toEqual({ ok: false, status: 415 });
    expect(await readJson(req({ 'content-type': 'application/json', 'content-length': '99' }, '{}'), 10)).toEqual({ ok: false, status: 413 });
    expect(await readJson(req({ 'content-type': 'application/json' }, '{"a":"éééééé"}'), 10)).toEqual({ ok: false, status: 413 });
    expect(await readJson(req({ 'content-type': 'application/json' }, '{'), 10)).toEqual({ ok: false, status: 400 });
    expect(await readJson(req({ 'content-type': 'application/json' }, '{"a":1}'), 10)).toEqual({ ok: true, value: { a: 1 } });
  });
  it('attente', async () => {
    await expect(sleep(1)).resolves.toBeUndefined();
  });
});
