import { describe, expect, it } from 'vitest';
import {
  ageOn,
  birthDateError,
  emailOnlySchema,
  formatPhone,
  isValidSiret,
  loginSchema,
  newPasswordSchema,
  normalizePhone,
  onboardingSchema,
  otpCodeSchema,
  passwordIssues,
  passwordMessage,
  profileUpdateSchema,
  signupSchema,
  accountDeleteRequestSchema,
} from './account.ts';

const today = new Date(2026, 9, 5); // 5 octobre 2026, heure locale

describe('mot de passe', () => {
  it('accepte un mot de passe fort', () => {
    expect(passwordIssues('Plombier-Avignon-2026')).toEqual([]);
    expect(passwordMessage([])).toBeNull();
  });
  it('liste chaque règle manquante', () => {
    expect(passwordIssues('court')).toEqual(['length', 'upper', 'digit']);
    expect(passwordIssues('TOUTENMAJUSCULE1')).toEqual(['lower']);
    expect(passwordMessage(['length'])).toBe('Ton mot de passe doit respecter les 4 règles.');
  });
  it('compte les caractères, pas les octets (accents)', () => {
    expect(passwordIssues('Éléphantéà12')).toEqual([]);
  });
  it('refuse au-delà de 72 octets (limite bcrypt)', () => {
    const long = `Aa1${'é'.repeat(40)}`;
    expect(passwordIssues(long)).toContain('max');
    expect(passwordMessage(['max', 'length'])).toBe('Mot de passe trop long (72 octets maximum).');
  });
  it('refuse un mot de passe qui contient l’adresse email', () => {
    expect(passwordIssues('Martin.Dupont2026', 'martin.dupont@exemple.fr')).toEqual(['email']);
    expect(passwordMessage(['email'])).toBe('Ton mot de passe ne doit pas contenir ton adresse email.');
    // Partie locale trop courte : pas de contrôle (faux positifs).
    expect(passwordIssues('Abcdefgh1234', 'abc@exemple.fr')).toEqual([]);
  });
});

describe('âge', () => {
  it('calcule l’âge révolu', () => {
    expect(ageOn('2008-10-05', today)).toBe(18);
    expect(ageOn('2008-10-06', today)).toBe(17);
    expect(ageOn('2008-11-01', today)).toBe(17);
    expect(ageOn('1990-01-15', today)).toBe(36);
  });
  it('refuse les dates invalides, futures ou absurdes', () => {
    expect(ageOn('2008-02-30', today)).toBeNull();
    expect(ageOn('05/10/2008', today)).toBeNull();
    expect(ageOn('2030-01-01', today)).toBeNull();
    expect(ageOn('1800-01-01', today)).toBeNull();
  });
  it('message de majorité', () => {
    expect(birthDateError('', today)).toBe('Indique ta date de naissance.');
    expect(birthDateError('2008-13-01', today)).toBe('Date de naissance invalide.');
    expect(birthDateError('2010-01-01', today)).toBe('Stacker est réservé aux personnes majeures.');
    expect(birthDateError('2000-01-01', today)).toBeNull();
  });
});

describe('SIRET et téléphone', () => {
  it('valide la clé de Luhn', () => {
    expect(isValidSiret('73282932000074')).toBe(true);
    expect(isValidSiret('73282932000075')).toBe(false);
    expect(isValidSiret('7328293200007')).toBe(false);
    expect(isValidSiret('7328293200007A')).toBe(false);
  });
  it('exception La Poste (somme multiple de 5)', () => {
    expect(isValidSiret('35600000000010')).toBe(true);
    expect(isValidSiret('35600000000011')).toBe(false);
  });
  it('normalise les numéros en E.164', () => {
    expect(normalizePhone('06 12 34 56 78')).toBe('+33612345678');
    expect(normalizePhone('06.12.34.56.78')).toBe('+33612345678');
    expect(normalizePhone('0033 6 12 34 56 78')).toBe('+33612345678');
    expect(normalizePhone('+32 470 12 34 56')).toBe('+32470123456');
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('00 12 34 56 78')).toBeNull();
  });
  it('affiche un numéro français lisiblement', () => {
    expect(formatPhone('+33612345678')).toBe('06 12 34 56 78');
    expect(formatPhone('+32470123456')).toBe('+32470123456');
  });
});

describe('schémas de formulaires', () => {
  const signup = {
    firstName: ' Inès ',
    email: ' INES@Exemple.fr ',
    password: 'Plombier-Avignon-2026',
    birthDate: '2000-01-01',
    adultConfirmed: true,
    termsAccepted: true,
    marketingOptIn: false,
  };
  it('inscription valide, normalisée', () => {
    const r = signupSchema.parse(signup);
    expect(r.firstName).toBe('Inès');
    expect(r.email).toBe('ines@exemple.fr');
  });
  it('inscription : mot de passe faible, cases non cochées, champ inconnu', () => {
    const r = signupSchema.safeParse({ ...signup, password: 'faible', adultConfirmed: false, termsAccepted: false });
    expect(r.success).toBe(false);
    const paths = r.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['password', 'adultConfirmed', 'termsAccepted']));
    expect(signupSchema.safeParse({ ...signup, role: 'admin' }).success).toBe(false);
  });
  it('connexion, email seul, code', () => {
    expect(loginSchema.parse({ email: 'A@B.fr', password: 'x' }).email).toBe('a@b.fr');
    expect(loginSchema.safeParse({ email: 'pas-un-email', password: '' }).success).toBe(false);
    expect(emailOnlySchema.safeParse({ email: 'a@b.fr' }).success).toBe(true);
    expect(otpCodeSchema.parse(' 123 456 ')).toBe('123456');
    expect(otpCodeSchema.safeParse('12345').success).toBe(false);
  });
  it('nouveau mot de passe : règles puis confirmation', () => {
    expect(newPasswordSchema.safeParse({ password: 'Plombier-Avignon-2026', confirm: 'Plombier-Avignon-2026', email: 'a@b.fr' }).success).toBe(true);
    const weak = newPasswordSchema.safeParse({ password: 'abc', confirm: 'abc', email: '' });
    expect(weak.error?.issues[0]?.path).toEqual(['password']);
    const diff = newPasswordSchema.safeParse({ password: 'Plombier-Avignon-2026', confirm: 'Plombier-Avignon-2027', email: '' });
    expect(diff.error?.issues[0]?.path).toEqual(['confirm']);
  });
  it('onboarding', () => {
    expect(onboardingSchema.parse({ firstName: 'Léa', department: '84', goal: 'complement' })).toEqual({ firstName: 'Léa', department: '84', goal: 'complement' });
    expect(onboardingSchema.safeParse({ firstName: '', department: '00', goal: 'riche' }).error?.issues).toHaveLength(3);
  });
  it('suppression : confirmation exacte', () => {
    expect(accountDeleteRequestSchema.safeParse({ confirm: 'SUPPRIMER' }).success).toBe(true);
    expect(accountDeleteRequestSchema.safeParse({ confirm: 'oui' }).success).toBe(false);
  });
});

describe('mise à jour du profil', () => {
  const base = { first_name: 'Inès', last_name: '', phone: '', department: '', city: '', legal_status: '', siret: '', goal: '' };
  it('champs vides → null', () => {
    expect(profileUpdateSchema.parse(base)).toEqual({ first_name: 'Inès', last_name: null, phone: null, department: null, city: null, legal_status: null, siret: null, goal: null });
  });
  it('champs remplis, normalisés', () => {
    expect(
      profileUpdateSchema.parse({ ...base, last_name: ' Martin ', phone: '06 12 34 56 78', department: '84', city: '  Villeneuve-lès-Avignon ', legal_status: 'micro_entrepreneur', siret: '732 829 320 00074', goal: 'decouvrir' }),
    ).toEqual({ first_name: 'Inès', last_name: 'Martin', phone: '+33612345678', department: '84', city: 'Villeneuve-lès-Avignon', legal_status: 'micro_entrepreneur', siret: '73282932000074', goal: 'decouvrir' });
  });
  it('erreurs de champ', () => {
    const r = profileUpdateSchema.safeParse({ ...base, first_name: '', phone: '123', department: '00', siret: '123', legal_status: 'pdg', city: 'x'.repeat(81), last_name: 'R2D2' });
    expect(r.error?.issues.map((i) => i.path[0]).sort()).toEqual(['city', 'department', 'first_name', 'last_name', 'legal_status', 'phone', 'siret']);
  });
  it('SIRET sans statut d’entreprise refusé', () => {
    const r = profileUpdateSchema.safeParse({ ...base, siret: '73282932000074', legal_status: 'sans_statut' });
    expect(r.error?.issues[0]?.path).toEqual(['siret']);
    expect(profileUpdateSchema.safeParse({ ...base, siret: '73282932000074' }).success).toBe(false);
  });
  it('refuse les champs serveur', () => {
    expect(profileUpdateSchema.safeParse({ ...base, tier: 'elite' }).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ ...base, xp: 1 }).success).toBe(false);
  });
});
