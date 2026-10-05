import type { ReactElement } from 'react';
import { isTodo } from '../config/site';

/**
 * Affiche une donnée éditoriale. Si elle n'est pas encore renseignée
 * ({{À COMPLÉTER : ...}} ou {{À VÉRIFIER : ...}}), elle est surlignée pour qu'on ne puisse pas la rater.
 */
export function Fill({ value, href }: { value: string; href?: string }): ReactElement {
  if (isTodo(value)) return <mark className="todo">{value}</mark>;
  return href ? <a href={href}>{value}</a> : <>{value}</>;
}
