import { useId, useState, type InputHTMLAttributes, type ReactElement, type ReactNode, type SelectHTMLAttributes } from 'react';
import { PASSWORD_RULE_LABELS, passwordIssues } from '@shared/account';
import { Icon, type IconName } from '../../components/Icon';

export function FieldError({ id, message }: { id: string; message: string | undefined }): ReactElement | null {
  if (!message) return null;
  return (
    <span className="field-error" id={id}>
      <Icon name="alert" />
      {message}
    </span>
  );
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & {
  label: ReactNode;
  error?: string | undefined;
  hint?: ReactNode;
  icon?: IconName;
  optional?: boolean;
  trailing?: ReactNode;
  /** Identifiant d'un élément descriptif supplémentaire (ex. règles du mot de passe). */
  extraDescribedBy?: string | undefined;
};

export function TextField({ label, error, hint, icon, optional, trailing, extraDescribedBy, ...input }: InputProps): ReactElement {
  const id = useId();
  const describedBy = [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null, extraDescribedBy ?? null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`field${error ? ' is-error' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        {optional ? <span className="field-optional"> (facultatif)</span> : null}
      </label>
      <div className="input-wrap">
        {icon ? <Icon name={icon} /> : null}
        <input id={id} className={`input${trailing ? ' has-trailing' : ''}`} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
        {trailing}
      </div>
      {hint && !error ? (
        <span className="field-hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

type PasswordProps = Omit<InputProps, 'type' | 'trailing' | 'icon'> & { checklist?: boolean; email?: string };

export function PasswordField({ checklist = false, email = '', value, ...rest }: PasswordProps): ReactElement {
  const [visible, setVisible] = useState(false);
  const listId = useId();
  const password = typeof value === 'string' ? value : '';
  const issues = passwordIssues(password, email);
  return (
    <div className="grid gap-3">
      <TextField
        {...rest}
        value={value}
        type={visible ? 'text' : 'password'}
        icon="lock"
        extraDescribedBy={checklist ? listId : undefined}
        trailing={
          <button
            type="button"
            className="input-action"
            aria-pressed={visible}
            aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            onClick={() => setVisible((v) => !v)}
          >
            <Icon name="eye" size={20} />
          </button>
        }
      />
      {checklist ? (
        <ul className="pw-rules" id={listId} aria-label="Règles du mot de passe">
          {(Object.keys(PASSWORD_RULE_LABELS) as (keyof typeof PASSWORD_RULE_LABELS)[]).map((rule) => {
            const ok = password !== '' && !issues.includes(rule);
            return (
              <li key={rule} className={ok ? 'is-ok' : undefined}>
                <Icon name={ok ? 'check-circle' : 'check'} size={16} />
                <span>
                  {PASSWORD_RULE_LABELS[rule]}
                  <span className="sr-only">{ok ? ' : respecté' : ' : à respecter'}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
  label: ReactNode;
  error?: string | undefined;
  optional?: boolean;
  options: readonly (readonly [string, string])[];
  placeholder: string;
};

export function SelectField({ label, error, optional, options, placeholder, ...select }: SelectProps): ReactElement {
  const id = useId();
  return (
    <div className={`field${error ? ' is-error' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
        {optional ? <span className="field-optional"> (facultatif)</span> : null}
      </label>
      <div className="select-wrap">
        <select id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...select}>
          <option value="">{placeholder}</option>
          {options.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function CheckField({
  children,
  error,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id'> & { children: ReactNode; error?: string | undefined }): ReactElement {
  const id = useId();
  return (
    <div className="grid gap-1">
      <label className={`check${error ? ' is-error' : ''}`} htmlFor={id}>
        <input id={id} type="checkbox" aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...input} />
        <span>{children}</span>
      </label>
      <FieldError id={`${id}-error`} message={error} />
    </div>
  );
}

export function FormAlert({ tone = 'error', children }: { tone?: 'error' | 'info' | 'success'; children: ReactNode }): ReactElement {
  return (
    <div className={`form-alert${tone === 'error' ? '' : ` form-alert-${tone}`}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={tone === 'success' ? 'check-circle' : tone === 'info' ? 'info' : 'alert'} />
      <div>{children}</div>
    </div>
  );
}

export function SubmitButton({ loading, children, variant = 'primary' }: { loading: boolean; children: ReactNode; variant?: 'primary' | 'accent' | 'danger-solid' }): ReactElement {
  return (
    <button type="submit" className={`btn btn-${variant} btn-block btn-lg${loading ? ' is-loading' : ''}`} aria-busy={loading || undefined} disabled={loading}>
      {children}
    </button>
  );
}

/** Erreurs Zod → message par champ (premier message de chaque champ). */
export function zodFieldErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path[0];
    if (typeof key === 'string' && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/** Place le focus sur le premier champ en erreur (ordre du DOM). */
export function focusFirstInvalid(form: HTMLFormElement | null): void {
  form?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
