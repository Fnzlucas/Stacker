import { useId, useState, type ReactElement, type SyntheticEvent } from 'react';
import { Icon } from '../components/Icon';
import { ENTITY, isTodo } from '../config/site';
import { CONTACT_SUBJECTS, buildMailto, contactSchema } from '../lib/mailto';

type Field = 'name' | 'email' | 'subject' | 'message';
type Errors = Partial<Record<Field, string>>;

/**
 * Formulaire de contact sobre : il prépare un email dans la messagerie de la
 * personne (lien mailto:). Le site n'envoie ni ne stocke rien.
 */
export function ContactForm(): ReactElement {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const [values, setValues] = useState({ name: '', email: '', subject: 'question', message: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [opened, setOpened] = useState(false);
  const configured = !isTodo(ENTITY.email);

  const set = (key: Field, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = contactSchema.safeParse(values);
    if (!parsed.success) {
      const errs: Errors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !(key in errs)) errs[key as Field] = issue.message;
      }
      setErrors(errs);
      const first = (['name', 'email', 'subject', 'message'] as const).find((f) => errs[f]);
      if (first) document.getElementById(id(first))?.focus();
      return;
    }
    if (!configured) return;
    window.location.href = buildMailto(ENTITY.email, parsed.data);
    setOpened(true);
  };

  const field = (key: Field) => ({
    id: id(key),
    name: key,
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? id(`${key}-error`) : undefined,
  });
  const errorText = (key: Field) =>
    errors[key] ? (
      <span className="field-error" id={id(`${key}-error`)}>
        <Icon name="alert" />
        {errors[key]}
      </span>
    ) : null;

  return (
    <form className="card grid gap-5" noValidate aria-label="Écrire à Stacker" onSubmit={onSubmit}>
      <div className={`field${errors.name ? ' is-error' : ''}`}>
        <label className="field-label" htmlFor={id('name')}>
          Nom
        </label>
        <input className="input" type="text" autoComplete="name" maxLength={80} required {...field('name')} value={values.name} onChange={(e) => set('name', e.target.value)} />
        {errorText('name')}
      </div>
      <div className={`field${errors.email ? ' is-error' : ''}`}>
        <label className="field-label" htmlFor={id('email')}>
          Adresse email
        </label>
        <input
          className="input"
          type="email"
          inputMode="email"
          autoComplete="email"
          spellCheck={false}
          required
          {...field('email')}
          value={values.email}
          onChange={(e) => set('email', e.target.value)}
        />
        {errorText('email')}
      </div>
      <div className={`field${errors.subject ? ' is-error' : ''}`}>
        <label className="field-label" htmlFor={id('subject')}>
          Sujet
        </label>
        <div className="select-wrap">
          <select className="input" {...field('subject')} value={values.subject} onChange={(e) => set('subject', e.target.value)}>
            {CONTACT_SUBJECTS.map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {errorText('subject')}
      </div>
      <div className={`field${errors.message ? ' is-error' : ''}`}>
        <label className="field-label" htmlFor={id('message')}>
          Message
        </label>
        <textarea className="input" rows={6} maxLength={2000} required {...field('message')} value={values.message} onChange={(e) => set('message', e.target.value)} />
        {errorText('message')}
      </div>

      {configured ? null : (
        <div className="form-alert" role="status">
          <Icon name="info" />
          <span>L’adresse de contact n’est pas encore renseignée : ce formulaire sera actif dès sa mise en ligne.</span>
        </div>
      )}

      <button className="btn btn-primary btn-block" type="submit" disabled={!configured}>
        <Icon name="send" />
        Préparer l’email
      </button>
      <p className="form-note" role="status" aria-live="polite">
        <Icon name="info" />
        <span>
          {opened
            ? 'Ta messagerie s’est ouverte avec ton message pré-rempli. Il ne reste qu’à l’envoyer.'
            : 'Ce formulaire ouvre ta messagerie avec ton message pré-rempli : rien n’est envoyé ni enregistré par le site.'}
        </span>
      </p>
    </form>
  );
}
