import { describe, expect, it } from 'vitest';
import { contactLinks, decodeObfuscation, extractEmails, extractPhone, extractSiren, fetchPage, isPrivateIp, pathAllowed, robotsDisallows, safeUrl, scrapeSite } from './scrape.ts';

const html = (body: string, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

describe('garde SSRF', () => {
  it('URL acceptées et refusées', () => {
    expect(safeUrl('https://plomberie-durand.fr/')?.hostname).toBe('plomberie-durand.fr');
    for (const bad of ['ftp://x.fr', 'http://127.0.0.1/', 'http://localhost/', 'http://intranet/', 'https://x.fr:8443/', 'https://user:pw@x.fr/', 'http://[::1]/', 'http://srv.internal/', 'pas une url']) expect(safeUrl(bad), bad).toBeNull();
  });
  it('adresses privées', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.16.3.4', '192.168.1.1', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) expect(isPrivateIp(ip), ip).toBe(true);
    for (const ip of ['93.184.216.34', '2a01:4f8::1']) expect(isPrivateIp(ip), ip).toBe(false);
  });
  it('redirection vers une adresse interne : abandon', async () => {
    const page = await fetchPage(async () => html('', 302, { location: 'http://169.254.169.254/latest/meta-data' }), safeUrl('https://x.fr/')!, null);
    expect(page).toBeNull();
  });
  it('hôte résolu vers une IP privée : aucune requête', async () => {
    let calls = 0;
    const page = await fetchPage(async () => {
      calls++;
      return html('<p>x</p>');
    }, safeUrl('https://piege.fr/')!, async () => ['10.1.2.3']);
    expect(page).toBeNull();
    expect(calls).toBe(0);
  });
  it('pas du HTML ou erreur : ignoré', async () => {
    expect(await fetchPage(async () => new Response('{}', { headers: { 'content-type': 'application/json' } }), safeUrl('https://x.fr/')!, null)).toBeNull();
    expect(await fetchPage(async () => html('', 500), safeUrl('https://x.fr/')!, null)).toBeNull();
    expect(
      await fetchPage(async () => {
        throw new Error('réseau');
      }, safeUrl('https://x.fr/')!, null),
    ).toBeNull();
  });
});

describe('robots.txt', () => {
  it('règles de notre agent, sinon celles de *', () => {
    const robots = 'User-agent: *\nDisallow: /admin\n\nUser-agent: StackerBot\nUser-agent: Autre\nDisallow: /prive\n# commentaire\nDisallow:';
    expect(robotsDisallows(robots)).toEqual(['/prive']);
    expect(robotsDisallows('User-agent: *\nDisallow: /')).toEqual(['/']);
    expect(pathAllowed('/contact', ['/'])).toBe(false);
    expect(pathAllowed('/contact', ['/admin'])).toBe(true);
    expect(pathAllowed('/admin/x', ['/admin*'])).toBe(false);
  });
});

describe('extraction', () => {
  it('adresses génériques du domaine, triées ; nominatives et parasites ignorées', () => {
    const page = `<a href="mailto:Contact@Plomberie-Durand.fr">Écrire</a> paul.durand@plomberie-durand.fr devis@plomberie-durand.fr
      logo@2x.png support@wixpress.com webmaster@agence-web.fr info [at] plomberie-durand [dot] fr`;
    expect(extractEmails(page, 'www.plomberie-durand.fr', 'Plomberie Durand')).toEqual(['contact@plomberie-durand.fr', 'devis@plomberie-durand.fr', 'info@plomberie-durand.fr']);
  });
  it('boîte grand public au nom de l’entreprise acceptée, personnelle refusée', () => {
    const page = 'plomberie.durand30@gmail.com jean.martin@gmail.com contact@orange.fr';
    expect(extractEmails(page, 'plomberie-durand.fr', 'Plomberie Durand')).toEqual(['contact@orange.fr', 'plomberie.durand30@gmail.com']);
    expect(extractEmails('jean.martin@gmail.com', 'x.fr', 'Garage du Pont')).toEqual([]);
  });
  it('obfuscations HTML', () => {
    expect(decodeObfuscation('contact&#64;x.fr contact&#x40;y.fr a&commat;b.fr c (at) d (dot) fr')).toBe('contact@x.fr contact@y.fr a@b.fr c@d.fr');
  });
  it('SIREN des mentions légales et téléphone', () => {
    expect(extractSiren('<p>SARL au capital de 1000 € — RCS Nîmes <b>812 345 678</b></p>')).toBe('812345678');
    expect(extractSiren('SIRET : 81234567800012')).toBe('812345678');
    expect(extractSiren('Tél 04 90 12 34 56')).toBeNull();
    expect(extractPhone('<a href="tel:04 90 12 34 56">Appeler</a>')).toBe('+33490123456');
    expect(extractPhone('<a href="tel:+33490123456">x</a>')).toBe('+33490123456');
    expect(extractPhone('<a href="tel:123">x</a>')).toBeNull();
  });
  it('liens contact et mentions légales internes seulement', () => {
    const base = new URL('https://x.fr/');
    const links = contactLinks('<a href="/contact">Contact</a><a href="https://autre.fr/contact">x</a><a href="/mentions-legales#a">Mentions</a><a href="/blog">Blog</a><a href="/contact">doublon</a>', base);
    expect(links.map((u) => u.toString())).toEqual(['https://x.fr/contact', 'https://x.fr/mentions-legales']);
  });
});

describe('parcours d’un site', () => {
  it('accueil → contact → mentions : email, page source, SIREN', async () => {
    const pages: Record<string, Response> = {
      'https://plomberie-durand.fr/robots.txt': new Response('User-agent: *\nDisallow: /admin'),
      'https://plomberie-durand.fr/': html('<a href="/nous-contacter">Contact</a><a href="/mentions-legales">Mentions légales</a><a href="tel:0490123456">Tél</a>'),
      'https://plomberie-durand.fr/nous-contacter': html('Écrivez-nous : contact@plomberie-durand.fr'),
      'https://plomberie-durand.fr/mentions-legales': html('SIREN 812 345 678'),
    };
    const seen: string[] = [];
    const r = await scrapeSite(async (url) => {
      seen.push(url);
      return pages[url]?.clone() ?? html('', 404);
    }, 'https://plomberie-durand.fr', 'Plomberie Durand', null);
    expect(r).toEqual({ email: 'contact@plomberie-durand.fr', sourceUrl: 'https://plomberie-durand.fr/nous-contacter', siren: '812345678', phone: '+33490123456', pages: 3 });
    expect(seen.every((u) => u.startsWith('https://plomberie-durand.fr/'))).toBe(true);
  });
  it('robots.txt interdit tout : aucune page lue', async () => {
    const r = await scrapeSite(async (url) => (url.endsWith('/robots.txt') ? new Response('User-agent: *\nDisallow: /') : html('contact@x.fr')), 'https://x.fr', 'X', null);
    expect(r.pages).toBe(0);
    expect(r.email).toBeNull();
  });
  it('sans lien contact : /contact et /mentions-legales essayés ; site inaccessible : vide', async () => {
    const r = await scrapeSite(async (url) => (url === 'https://x.fr/contact' ? html('bonjour@x.fr') : url.endsWith('robots.txt') ? new Response('', { status: 404 }) : html('<p>Accueil</p>')), 'https://x.fr', 'X', null);
    expect(r.email).toBe('bonjour@x.fr');
    expect((await scrapeSite(async () => html('', 500), 'https://x.fr', 'X', null)).pages).toBe(0);
    expect((await scrapeSite(async () => html(''), 'ftp://x.fr', 'X', null)).pages).toBe(0);
  });
});
