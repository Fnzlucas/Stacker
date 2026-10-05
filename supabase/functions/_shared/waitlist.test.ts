import { describe, expect, it } from 'vitest';
import {
  DEPARTMENTS,
  REFERRAL_ALPHABET,
  REFERRAL_CODE_RE,
  buildReferralUrl,
  fieldErrors,
  generateReferralCode,
  isDepartmentCode,
  normalizeEmail,
  normalizeFirstName,
  normalizeReferralCode,
  waitlistFieldsSchema,
  waitlistJoinRequestSchema,
  waitlistJoinResponseSchema,
} from './waitlist.ts';

const valid = {
  firstName: 'Inès',
  email: 'ines@exemple.fr',
  department: '84',
  ageConfirmed: true,
  termsAccepted: true,
  marketingOptIn: false,
};

describe('normalizeEmail', () => {
  it('retire les espaces de bord et passe en minuscules', () => {
    expect(normalizeEmail('  Ines.Martin@Exemple.FR \n')).toBe('ines.martin@exemple.fr');
  });
  it('applique NFKC (caractères pleine chasse)', () => {
    expect(normalizeEmail('ｉｎｅｓ@exemple.fr')).toBe('ines@exemple.fr');
  });
  it('conserve les points et les étiquettes « + » (adresses distinctes)', () => {
    expect(normalizeEmail('a.b+stacker@gmail.com')).toBe('a.b+stacker@gmail.com');
  });
  it('est idempotente', () => {
    const once = normalizeEmail(' X@Y.FR ');
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe('normalizeFirstName', () => {
  it('réduit les espaces multiples et retire ceux de bord', () => {
    expect(normalizeFirstName('  Jean   Pierre ')).toBe('Jean Pierre');
  });
  it('normalise en NFC (e + accent combinant → é)', () => {
    expect(normalizeFirstName('Ine\u0301s')).toBe('In\u00e9s');
  });
});

describe('codes de parrainage', () => {
  it('l’alphabet compte 32 symboles sans I, O, 0 ni 1', () => {
    expect(REFERRAL_ALPHABET).toHaveLength(32);
    expect(new Set(REFERRAL_ALPHABET).size).toBe(32);
    expect(REFERRAL_ALPHABET).not.toMatch(/[IO01]/);
  });

  it('génère un code de 8 caractères valide (aléa réel)', () => {
    for (let i = 0; i < 200; i++) expect(generateReferralCode()).toMatch(REFERRAL_CODE_RE);
  });

  it('est déterministe pour un aléa donné et couvre tout l’alphabet', () => {
    expect(generateReferralCode(() => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))).toBe('ABCDEFGH');
    expect(generateReferralCode(() => new Uint8Array([31, 63, 95, 127, 159, 191, 223, 255]))).toBe('99999999');
    expect(generateReferralCode(() => new Uint8Array([32, 33, 34, 35, 36, 37, 38, 39]))).toBe('ABCDEFGH');
  });

  it('refuse une source d’aléa de mauvaise longueur', () => {
    expect(() => generateReferralCode(() => new Uint8Array(4))).toThrow();
  });

  it.each([
    ['abcdefgh', 'ABCDEFGH'],
    ['  k7m2p9qr ', 'K7M2P9QR'],
  ])('normalise %j en %j', (input, expected) => {
    expect(normalizeReferralCode(input)).toBe(expected);
  });

  it.each([null, undefined, 42, '', 'ABC', 'ABCDEFGHI', 'ABCDEFG0', 'ABCDEFGI', 'ABCD-EFG'])(
    'ignore une valeur invalide (%j)',
    (input) => {
      expect(normalizeReferralCode(input)).toBeNull();
    },
  );

  it('construit le lien de parrainage public', () => {
    expect(buildReferralUrl('https://stacker.example', 'K7M2P9QR')).toBe('https://stacker.example/liste-attente?ref=K7M2P9QR');
  });
});

describe('départements', () => {
  it('liste 101 départements uniques, Corse et outre-mer compris', () => {
    const codes = DEPARTMENTS.map(([c]) => c);
    expect(codes).toHaveLength(101);
    expect(new Set(codes).size).toBe(101);
    expect(codes).toEqual(expect.arrayContaining(['01', '2A', '2B', '95', '971', '976']));
  });
  it.each(['20', '96', '975', '00', '1', ''])('refuse %j', (code) => {
    expect(isDepartmentCode(code)).toBe(false);
  });
  it('correspond à la contrainte SQL (même liste)', () => {
    const sqlRe = /^(0[1-9]|1[0-9]|2[1-9]|[3-8][0-9]|9[0-5]|2A|2B|97[1-46])$/;
    for (const [code] of DEPARTMENTS) expect(code).toMatch(sqlRe);
    for (const code of ['20', '96', '975', '977']) expect(code).not.toMatch(sqlRe);
  });
});

describe('waitlistFieldsSchema', () => {
  it('accepte une saisie valide et la normalise', () => {
    const out = waitlistFieldsSchema.parse({ ...valid, firstName: '  Inès ', email: ' INES@Exemple.fr ', referralCode: 'k7m2p9qr' });
    expect(out).toEqual({ ...valid, firstName: 'Inès', email: 'ines@exemple.fr', referralCode: 'K7M2P9QR' });
  });

  it('rend le département et le parrainage facultatifs', () => {
    const out = waitlistFieldsSchema.parse({ ...valid, department: '' });
    expect(out.department).toBeNull();
    expect(out.referralCode).toBeNull();
    expect(waitlistFieldsSchema.parse({ ...valid, department: null }).department).toBeNull();
    const { department: _omit, ...withoutDepartment } = valid;
    expect(waitlistFieldsSchema.parse(withoutDepartment).department).toBeNull();
  });

  it('met le consentement marketing à false par défaut', () => {
    const { marketingOptIn: _omit, ...rest } = valid;
    expect(waitlistFieldsSchema.parse(rest).marketingOptIn).toBe(false);
  });

  it('ignore un code de parrainage invalide sans bloquer l’inscription', () => {
    expect(waitlistFieldsSchema.parse({ ...valid, referralCode: 'nope' }).referralCode).toBeNull();
  });

  it.each([
    ['email', 'pas-un-email'],
    ['email', 'a@b'],
    ['email', `${'a'.repeat(250)}@exemple.fr`],
    ['email', 42],
    ['firstName', ''],
    ['firstName', '   '],
    ['firstName', 'a'.repeat(51)],
    ['firstName', 'Robert<script>'],
    ['firstName', '123'],
    ['department', '20'],
    ['department', '9999'],
    ['ageConfirmed', false],
    ['termsAccepted', false],
  ])('refuse %s = %j avec un message en français', (field, value) => {
    const res = waitlistFieldsSchema.safeParse({ ...valid, [field]: value });
    expect(res.success).toBe(false);
    if (!res.success) {
      const errors = fieldErrors(res.error);
      expect(errors[field as keyof typeof errors]).toMatch(/[a-zé]/);
    }
  });

  it('accepte les prénoms composés et accentués', () => {
    for (const firstName of ['Jean-Pierre', 'Zoé', 'Anne Marie', "D'Arcy", 'Ségolène', 'Ñandú', 'J.']) {
      expect(waitlistFieldsSchema.safeParse({ ...valid, firstName }).success).toBe(true);
    }
  });

  it('refuse les champs inconnus (objet strict)', () => {
    expect(waitlistFieldsSchema.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
  });

  it('exige ageConfirmed et termsAccepted à true (pas seulement présents)', () => {
    expect(waitlistFieldsSchema.safeParse({ ...valid, ageConfirmed: 'true' }).success).toBe(false);
    expect(waitlistFieldsSchema.safeParse({ ...valid, termsAccepted: 1 }).success).toBe(false);
  });
});

describe('waitlistJoinRequestSchema', () => {
  it('jeton Turnstile facultatif (exigé par le serveur seulement si activé), mais borné', () => {
    expect(waitlistJoinRequestSchema.safeParse(valid).success).toBe(true);
    expect(waitlistJoinRequestSchema.safeParse({ ...valid, turnstileToken: '' }).success).toBe(false);
    expect(waitlistJoinRequestSchema.safeParse({ ...valid, turnstileToken: 'x'.repeat(2049) }).success).toBe(false);
    expect(waitlistJoinRequestSchema.safeParse({ ...valid, turnstileToken: 'tok' }).success).toBe(true);
  });
});

describe('waitlistJoinResponseSchema', () => {
  it('valide la réponse de succès et rien de plus', () => {
    const ok = { ok: true, position: 3, referralCode: 'K7M2P9QR', referralUrl: 'https://s.example/liste-attente?ref=K7M2P9QR' };
    expect(waitlistJoinResponseSchema.safeParse(ok).success).toBe(true);
    expect(waitlistJoinResponseSchema.safeParse({ ...ok, email: 'x@y.fr' }).success).toBe(false);
    expect(waitlistJoinResponseSchema.safeParse({ ...ok, position: 0 }).success).toBe(false);
  });
});

describe('fieldErrors', () => {
  it('ne garde que la première erreur par champ et ignore les erreurs globales', () => {
    const res = waitlistFieldsSchema.safeParse({ ...valid, email: '', unknown: 1 });
    expect(res.success).toBe(false);
    if (!res.success) {
      const errors = fieldErrors(res.error);
      expect(Object.keys(errors)).toEqual(['email']);
    }
  });
});
