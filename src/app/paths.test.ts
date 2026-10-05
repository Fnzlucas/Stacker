import { describe, expect, it } from 'vitest';
import { PATHS, safeReturnPath } from './paths';

describe('retour après connexion', () => {
  it('accepte un chemin interne de l’app', () => {
    expect(safeReturnPath({ from: '/app/profil' })).toBe('/app/profil');
    expect(safeReturnPath({ from: '/app' })).toBe('/app');
  });
  it('refuse tout le reste (redirection ouverte, URL externe, type inattendu)', () => {
    for (const from of ['https://evil.example', '//evil.example', '/app/../admin', '/appli', '/app/profil?x=1', 42, null]) {
      expect(safeReturnPath({ from })).toBe(PATHS.home);
    }
    expect(safeReturnPath(null)).toBe(PATHS.home);
    expect(safeReturnPath('texte')).toBe(PATHS.home);
  });
});
