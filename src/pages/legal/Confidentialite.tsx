/*
 * À faire valider par un juriste avant la mise en ligne en production.
 * Brouillon rédigé par l'équipe technique : il ne constitue pas un avis juridique.
 * Les jetons {{À COMPLÉTER : ...}} / {{À VÉRIFIER : ...}} viennent de src/config/site.ts.
 */
import type { ReactElement } from 'react';
import { Fill } from '../../components/Fill';
import { LegalPage } from '../../components/LegalPage';
import { ENTITY, todo } from '../../config/site';

const SUPABASE_REGION = todo('région Supabase retenue (Paris eu-west-3 ou Francfort eu-central-1)');

export function ConfidentialitePage(): ReactElement {
  return (
    <LegalPage
      title="Politique de confidentialité"
      intro={
        <p>
          Cette politique explique quelles données personnelles Stacker traite, pourquoi, sur quelle base légale, combien de temps, avec quels
          prestataires, et comment exercer tes droits. Nous collectons le strict nécessaire et ne vendons aucune donnée.
        </p>
      }
      sections={[
        {
          id: 'responsable',
          title: '1. Responsable du traitement',
          body: (
            <>
              <p>
                {ENTITY.legalName}, entrepreneur individuel (micro-entreprise), éditeur de Stacker, <Fill value={ENTITY.address} />.
              </p>
              <p>
                Contact pour toute question sur tes données : <Fill value={ENTITY.email} />. Stacker n’a pas désigné de délégué à la
                protection des données, cette désignation n’étant pas obligatoire pour son activité ; l’adresse ci-dessus est traitée directement par
                le responsable.
              </p>
            </>
          ),
        },
        {
          id: 'traitements',
          title: '2. Données, finalités, bases légales et durées',
          body: (
            <>
              <div className="table-wrap" role="region" aria-labelledby="traitements" tabIndex={0}>
                <table>
                  <caption className="sr-only">Traitements de données personnelles</caption>
                  <thead>
                    <tr>
                      <th scope="col">Finalité</th>
                      <th scope="col">Données</th>
                      <th scope="col">Base légale</th>
                      <th scope="col">Durée de conservation</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td data-label="Finalité">Gérer la liste d’attente, t’attribuer une position, t’envoyer la confirmation et te prévenir de l’ouverture</td>
                      <td data-label="Données">Prénom, email, département (facultatif), déclaration de majorité, code de parrainage, parrain éventuel, date d’inscription</td>
                      <td data-label="Base légale">Exécution des CGU que tu acceptes (art. 6.1.b RGPD)</td>
                      <td data-label="Durée de conservation">
                        Jusqu’à la création de ton compte (les données sont alors reprises dans ton compte) ; à défaut, 12 mois après l’ouverture
                        publique, puis suppression. Suppression immédiate sur demande.
                      </td>
                    </tr>
                    <tr>
                      <td data-label="Finalité">Conserver la preuve de ton acceptation des CGU et de tes choix de consentement</td>
                      <td data-label="Données">Version des documents acceptés, choix marketing, date et heure</td>
                      <td data-label="Base légale">Obligation légale de pouvoir démontrer le consentement (art. 6.1.c et 7.1 RGPD)</td>
                      <td data-label="Durée de conservation">Durée de l’inscription ou du compte, puis 5 ans (prescription)</td>
                    </tr>
                    <tr>
                      <td data-label="Finalité">T’envoyer des conseils et actualités de Stacker par email (uniquement si tu l’as accepté)</td>
                      <td data-label="Données">Prénom, email</td>
                      <td data-label="Base légale">Consentement, facultatif et retirable à tout moment (art. 6.1.a RGPD)</td>
                      <td data-label="Durée de conservation">Jusqu’au retrait du consentement, ou 3 ans après notre dernier échange</td>
                    </tr>
                    <tr>
                      <td data-label="Finalité">Protéger le formulaire contre les robots et les abus</td>
                      <td data-label="Données">
                        Empreinte non réversible (hachage salé) de l’adresse IP pour limiter le nombre d’inscriptions ; si la vérification
                        anti-robot est activée, signaux techniques du navigateur traités par Cloudflare Turnstile
                      </td>
                      <td data-label="Base légale">Intérêt légitime : sécurité du service (art. 6.1.f RGPD)</td>
                      <td data-label="Durée de conservation">Empreinte d’IP : 24 heures. Cloudflare : selon sa politique, pour la seule vérification</td>
                    </tr>
                    <tr>
                      <td data-label="Finalité">Assurer le fonctionnement et la sécurité du site (journaux techniques)</td>
                      <td data-label="Données">Adresse IP, navigateur, pages demandées, date et heure</td>
                      <td data-label="Base légale">Intérêt légitime : sécurité et bon fonctionnement (art. 6.1.f RGPD)</td>
                      <td data-label="Durée de conservation">Durée fixée par l’hébergeur concerné, au plus 12 mois</td>
                    </tr>
                    <tr>
                      <td data-label="Finalité">Répondre à tes messages</td>
                      <td data-label="Données">Nom, email, contenu de ton message</td>
                      <td data-label="Base légale">Intérêt légitime à répondre aux demandes reçues (art. 6.1.f RGPD)</td>
                      <td data-label="Durée de conservation">3 ans après notre dernier échange</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p>
                <strong>À l’ouverture de l’application</strong>, d’autres traitements s’ajouteront (compte, abonnement, commissions, versements,
                obligations comptables et fiscales). Cette politique sera complétée avant leur mise en œuvre, et tu en seras informé.
              </p>
              <p>Aucune décision produisant des effets juridiques n’est prise sur le seul fondement d’un traitement automatisé.</p>
            </>
          ),
        },
        {
          id: 'destinataires',
          title: '3. Destinataires et prestataires',
          body: (
            <>
              <p>
                Tes données sont accessibles uniquement à l’éditeur et aux prestataires techniques qui agissent pour son compte (sous-traitants au
                sens du RGPD), chacun pour sa seule mission :
              </p>
              <ul>
                <li>
                  <strong>Supabase Inc.</strong> : base de données et fonctions serveur. Données stockées dans l’Union européenne (
                  <Fill value={SUPABASE_REGION} />
                  ).
                </li>
                <li>
                  <strong>Vercel Inc.</strong> (États-Unis) : hébergement et diffusion du site.
                </li>
                <li>
                  <strong>Brevo (Sendinblue SAS, France)</strong> : envoi des emails transactionnels (confirmation, invitation).
                </li>
                <li>
                  <strong>Cloudflare Inc.</strong> (États-Unis) : protection anti-robot Turnstile, lorsqu’elle est activée.
                </li>
                <li>
                  <strong>Mollie B.V.</strong> (Pays-Bas) : paiement de l’abonnement, à l’ouverture des paiements. Mollie agit aussi comme
                  responsable de traitement distinct pour ses propres obligations légales (lutte contre la fraude et le blanchiment).
                </li>
              </ul>
              <p>Aucune donnée n’est vendue, louée ou cédée à des fins commerciales.</p>
            </>
          ),
        },
        {
          id: 'transferts',
          title: '4. Transferts hors de l’Union européenne',
          body: (
            <p>
              Certains prestataires sont établis aux États-Unis ou peuvent y accéder aux données pour assurer leur service (Supabase, Vercel,
              Cloudflare). Ces transferts sont encadrés par la décision d’adéquation de la Commission européenne du 10 juillet 2023 (Data Privacy
              Framework) pour les entreprises certifiées et, à défaut, par les clauses contractuelles types de la Commission européenne. Tu peux en
              obtenir une copie en écrivant à <Fill value={ENTITY.email} />.
            </p>
          ),
        },
        {
          id: 'traceurs',
          title: '5. Cookies et traceurs',
          body: (
            <>
              <p>
                Le site n’utilise <strong>aucun cookie publicitaire ni de mesure d’audience</strong>, et aucune police ou ressource n’est chargée
                depuis un service tiers, à l’exception de la vérification anti-robot. C’est pourquoi aucun bandeau de consentement ne s’affiche.
              </p>
              <p>
                Lorsqu’elle est activée, la vérification Cloudflare Turnstile, chargée sur les pages qui contiennent le formulaire d’inscription, peut lire ou déposer des
                informations techniques strictement nécessaires à la sécurité du formulaire. Ces traceurs sont exemptés de consentement (article 82
                de la loi Informatique et Libertés). Si une mesure d’audience est ajoutée un jour, elle sera configurée pour être exemptée ou soumise
                à ton accord préalable.
              </p>
            </>
          ),
        },
        {
          id: 'securite',
          title: '6. Sécurité',
          body: (
            <p>
              Les échanges sont chiffrés (HTTPS). Le stockage chiffré au repos est assuré par l’hébergeur de la base de données. L’accès à la liste
              d’attente est fermé à tout visiteur : les données ne peuvent être écrites que par une fonction serveur dédiée, et seul le nombre total
              d’inscrits est public. Les adresses IP utilisées contre les abus ne sont jamais conservées en clair. En cas de violation de données
              présentant un risque, Stacker notifie la CNIL dans les 72 heures et informe les personnes concernées lorsque la loi l’exige.
            </p>
          ),
        },
        {
          id: 'droits',
          title: '7. Tes droits',
          body: (
            <>
              <p>Tu disposes à tout moment des droits suivants sur tes données :</p>
              <ul>
                <li>accès et copie ;</li>
                <li>rectification ;</li>
                <li>effacement (par exemple pour quitter la liste d’attente) ;</li>
                <li>limitation du traitement ;</li>
                <li>opposition aux traitements fondés sur l’intérêt légitime ;</li>
                <li>portabilité des données que tu nous as fournies ;</li>
                <li>retrait de ton consentement, sans effet sur les traitements déjà réalisés ;</li>
                <li>définition de directives sur le sort de tes données après ton décès.</li>
              </ul>
              <p>
                Pour les exercer, écris à <Fill value={ENTITY.email} /> depuis l’adresse inscrite (ou en justifiant de ton identité si ce n’est
                pas possible). Nous répondons dans un délai d’un mois, prolongeable de deux mois si la demande est complexe, auquel cas tu en es
                informé.
              </p>
              <p>
                Si tu estimes que tes droits ne sont pas respectés, tu peux adresser une réclamation à la CNIL : 3 place de Fontenoy, TSA 80715,
                75334 Paris Cedex 07, ou en ligne sur <a href="https://www.cnil.fr/fr/plaintes">cnil.fr</a>.
              </p>
            </>
          ),
        },
        {
          id: 'mineurs',
          title: '8. Personnes mineures',
          body: (
            <p>
              Stacker est réservé aux personnes majeures. Si nous apprenons qu’une personne mineure s’est inscrite, son inscription et ses données
              sont supprimées.
            </p>
          ),
        },
        {
          id: 'entreprises',
          title: '9. Entreprises contactées par un stacker',
          body: (
            <p>
              Les stackers recherchent des entreprises à partir de données publiques (notamment l’API Recherche d’entreprises de l’État) et les
              contactent sur leurs coordonnées professionnelles, pour leur proposer les services de Stacker. Ce traitement repose sur l’intérêt
              légitime de Stacker à prospecter des professionnels pour des services en rapport avec leur activité. Toute entreprise ou personne
              contactée peut s’y opposer à tout moment, simplement, en écrivant à <Fill value={ENTITY.email} /> : ses coordonnées sont
              alors ajoutées à une liste d’opposition commune à tous les stackers. Les données de prospection sont conservées 3 ans au plus après le
              dernier contact.
            </p>
          ),
        },
        {
          id: 'modifications',
          title: '10. Modifications',
          body: (
            <p>
              Cette politique peut évoluer, notamment à l’ouverture de l’application. La date de la dernière mise à jour figure en haut de la page ;
              toute modification importante est signalée par email aux personnes concernées.
            </p>
          ),
        },
      ]}
    />
  );
}
