# Autoblog

**Générateur de blog par IA, auto-hébergé et en marque blanche.** Autoblog
choisit les sujets, rédige, illustre et planifie des articles optimisés pour le
référencement au nom de votre marque, puis les met à disposition via une API
JSON simple pour les afficher sur n'importe quel site.

*[English version](README.md)*

- ✍️ **Écrit comme votre marque** : nom, audience, ton, langue, contexte de
  l'entreprise et appel à l'action sont des réglages, pas du code.
- 🧭 **Trouve des sujets neufs** : propose des sujets à partir de vos angles et
  écarte automatiquement ceux trop proches de vos derniers articles.
- 🖼️ **Illustre** : une image de couverture et jusqu'à 3 images dans le corps,
  dans votre style visuel.
- 🗓️ **Tourne tout seul** : tous les N jours, certains jours de la semaine ou
  une fois par mois, à votre heure locale, avec jusqu'à 30 jours d'articles
  d'avance.
- 🔌 **Se branche partout** : `GET /api/posts` renvoie le HTML *et* le Markdown
  avec les champs SEO. Next.js, Astro, Nuxt, WordPress, Webflow, une page
  statique… tout ce qui sait lire du JSON.
- 🤖 **Votre IA, vos clés** : Google Gemini, OpenAI ou Anthropic pour le texte ;
  Gemini ou OpenAI pour les images. Les clés restent dans vos variables
  d'environnement.
- 🌍 Interface d'administration en anglais et en français. Articles dans
  n'importe quelle langue.

## Fonctionnement

Un déploiement = un blog. Un article sans date est un brouillon, une date
future signifie « planifié », une date passée signifie « en ligne ». Rien
d'autre à gérer.

## Déployer (environ 10 minutes)

Il vous faut un projet [Supabase](https://supabase.com) gratuit, un compte
[Vercel](https://vercel.com) et au moins une clé d'API d'IA.

1. **Créer la base.** Dans un nouveau projet Supabase, ouvrez *SQL Editor* et
   exécutez le contenu de [`supabase/migrations/`](supabase/migrations) (ou
   `supabase db push` avec la CLI Supabase).
2. **Déployer** avec le bouton « Deploy with Vercel » du [README anglais](README.md#deploy-about-10-minutes),
   puis ajoutez au moins une des variables `GEMINI_API_KEY`, `OPENAI_API_KEY`,
   `ANTHROPIC_API_KEY` et redéployez. Toutes les variables sont décrites dans
   [`.env.example`](.env.example).
3. **Autoriser la redirection de connexion.** Dans Supabase, *Authentication →
   URL Configuration* : *Site URL* = votre URL Vercel, et ajoutez
   `https://<votre-app>.vercel.app/auth/callback` aux URL de redirection
   (gardez aussi `http://localhost:3000/auth/callback` pour le développement local).
4. **Se connecter** sur `https://<votre-app>.vercel.app/login` avec une adresse
   listée dans `ADMIN_EMAILS` (lien magique, sans mot de passe). Seules ces
   adresses reçoivent un lien.
5. **Configurer** votre marque dans *Réglages*, générer un premier article,
   puis ouvrir *Connecter votre site* pour les extraits de code à copier.

> **Avant la mise en production (Supabase → Authentication).**
> - L'envoi d'e-mails intégré à Supabase est limité à quelques messages par
>   heure : configurez un SMTP (Resend, Postmark, Brevo…) pour des liens fiables.
> - Laissez *Confirm email* activé (par défaut) : l'accès admin dépend de
>   l'adresse de la session, elle doit donc être vérifiée.
> - Une fois vos admins connectés une première fois, désactivez les inscriptions.
> - Facultatif : pour qu'un lien ouvert dans un autre navigateur fonctionne,
>   remplacez le lien du modèle d'e-mail *Magic Link* par
>   `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`.

> **Automatisation et offres Vercel.** `vercel.json` déclenche le générateur
> une fois par jour (le maximum de l'offre gratuite). Chaque appel remplit
> jusqu'à 2 créneaux vides : un rythme quotidien ou plus lent garde le stock
> plein. Pour aller plus vite, appelez `GET /api/cron/tick` avec
> `Authorization: Bearer $CRON_SECRET` depuis n'importe quel planificateur
> externe (GitHub Actions, cron-job.org…).

## Brancher votre site

```js
const API = "https://<votre-app>.vercel.app";

const { posts } = await fetch(`${API}/api/posts?limit=10`).then((r) => r.json());
const { post } = await fetch(`${API}/api/posts/${slug}`).then((r) => r.json());
document.querySelector("#article").innerHTML = post.contentHtml; // HTML déjà nettoyé
```

Contrat complet de l'API : [`docs/architecture.md`](docs/architecture.md).

## Développer en local

```bash
npm install
cp .env.example .env.local   # renseignez votre projet Supabase et une clé d'IA
npm run dev
```

```bash
npm test        # tests unitaires (Vitest)
npm run lint
npm run build
```

## Coûts

Autoblog est gratuit. Vous payez votre fournisseur d'IA à l'article : avec un
modèle de texte rapide et 3 images, comptez de quelques centimes à quelques
dizaines de centimes selon le fournisseur et les modèles choisis. Réglez le
fournisseur d'images sur `none` pour ne générer que du texte.

## Licence

[MIT](LICENSE)
