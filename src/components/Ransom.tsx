import type { ReactElement } from 'react';

/**
 * Titre « lettres découpées » du design system (design/ui.js → ransomHTML),
 * réservé aux moments forts. Les lecteurs d'écran lisent le texte entier.
 * Pas d'attribut style (CSP stricte) : l'index d'animation passe par une
 * classe .ri-N définie dans site.css.
 */
const ROTATION = ['rc0', 'rc1', 'rc2', 'rc3', 'rc4', 'rc5'] as const;

export function Ransom({ text, className, animated = false }: { text: string; className?: string; animated?: boolean }): ReactElement {
  let i = 0;
  const words = text.trim().split(/\s+/);
  const cls = ['ransom', animated ? 'is-animated' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={cls}>
      <span className="sr-only">{text}</span>
      {words.map((word, w) => (
        <span className="w" aria-hidden="true" key={`${word}-${String(w)}`}>
          {Array.from(word).map((ch) => {
            const n = i++;
            return (
              <span key={n} className={`l ${ROTATION[n % ROTATION.length] ?? 'rc0'} ri-${String(Math.min(n, 23))}`}>
                {ch}
              </span>
            );
          })}
        </span>
      ))}
    </span>
  );
}
