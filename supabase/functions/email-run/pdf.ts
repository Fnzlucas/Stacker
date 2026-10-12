/**
 * PDF du contrat signé : texte rendu par le serveur au moment de la
 * signature (identique à ce que le client a lu), signature manuscrite,
 * empreinte SHA-256 du texte, pagination. Polices standard (WinAnsi) : tout
 * caractère hors de ce jeu est remplacé, jamais d'échec.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export interface ContractPdfInput {
  reference: string;
  companyName: string;
  contractText: string;
  contractSha256: string;
  signaturePng: string;
  signedAt: string;
}

// Caractères WinAnsi au-delà du Latin-1 (plage 0x80–0x9F de Windows-1252).
const WIN_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const REPLACE: Record<string, string> = { ' ': ' ', ' ': ' ', '→': '->', '≤': '<=', '≥': '>=', '−': '-', '‑': '-', '­': '' };

/** Texte encodable en WinAnsi (police standard du PDF). */
export function winAnsi(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch in REPLACE) out += REPLACE[ch] ?? '';
    else if (ch === '\n' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || WIN_EXTRA.has(ch)) out += ch;
    else if (ch === '\t') out += '  ';
    else out += '?';
  }
  return out;
}

/** Découpe un paragraphe en lignes tenant dans la largeur donnée. */
export function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Mot plus long que la ligne (IBAN, URL) : coupé au caractère.
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length - 1;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const SIZE = 10;
const LEADING = 14.5;

export async function contractPdf(input: ContractPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(winAnsi(`Contrat ${input.reference} — ${input.companyName}`));
  doc.setAuthor('Stacker');
  doc.setSubject('Contrat d’abonnement et mandat de prélèvement SEPA');
  doc.setCreationDate(new Date(input.signedAt));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = A4[0] - MARGIN * 2;
  const ink = rgb(0.11, 0.11, 0.12);
  const grey = rgb(0.39, 0.39, 0.41);

  let page: PDFPage = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  const newPage = () => {
    page = doc.addPage(A4);
    y = A4[1] - MARGIN;
  };

  page.drawText('Stacker', { x: MARGIN, y, size: 18, font: bold, color: ink });
  page.drawText(winAnsi(`Contrat ${input.reference}`), { x: A4[0] - MARGIN - bold.widthOfTextAtSize(winAnsi(`Contrat ${input.reference}`), 11), y: y + 4, size: 11, font: bold, color: grey });
  y -= 34;

  const lines = wrap(winAnsi(input.contractText), font, SIZE, width);
  for (const [i, line] of lines.entries()) {
    if (y < MARGIN + 30) newPage();
    // Titres de section : lignes en majuscules.
    const heading = line.length > 3 && line === line.toUpperCase() && /[A-Z]/.test(line) && (lines[i - 1] ?? '') === '';
    page.drawText(line, { x: MARGIN, y, size: SIZE, font: heading ? bold : font, color: ink });
    y -= LEADING;
  }

  // Signature du client.
  const base64 = input.signaturePng.replace(/^data:image\/png;base64,/, '');
  const png = await doc.embedPng(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  const scale = Math.min(220 / png.width, 90 / png.height, 1);
  const sig = { w: png.width * scale, h: png.height * scale };
  if (y - sig.h - 60 < MARGIN) newPage();
  y -= 10;
  page.drawText('Signature du client', { x: MARGIN, y, size: SIZE, font: bold, color: ink });
  y -= sig.h + 8;
  page.drawRectangle({ x: MARGIN - 4, y: y - 4, width: sig.w + 8, height: sig.h + 8, borderColor: rgb(0.85, 0.85, 0.88), borderWidth: 1 });
  page.drawImage(png, { x: MARGIN, y, width: sig.w, height: sig.h });
  y -= 22;
  const signedOn = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'Europe/Paris' }).format(new Date(input.signedAt));
  page.drawText(winAnsi(`Signé électroniquement le ${signedOn} (heure de Paris).`), { x: MARGIN, y, size: 9, font, color: grey });

  // Pied de page : empreinte et pagination.
  const pages = doc.getPages();
  for (const [i, p] of pages.entries()) {
    p.drawText(winAnsi(`Empreinte SHA-256 du texte signé : ${input.contractSha256}`), { x: MARGIN, y: 28, size: 7, font, color: grey });
    const label = `${String(i + 1)} / ${String(pages.length)}`;
    p.drawText(label, { x: A4[0] - MARGIN - font.widthOfTextAtSize(label, 8), y: 28, size: 8, font, color: grey });
  }
  return doc.save();
}

/** Base64 d'un contenu binaire (pièce jointe Brevo). */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
