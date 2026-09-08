# Déployer le quiz FIMANI sur Render

Ce dossier contient un site complet et autonome (il ne dépend plus de Claude) :
- `server.js` : le serveur (Node.js + Express) qui sert le quiz et enregistre les participations dans une base PostgreSQL.
- `public/index.html` : la page du quiz (profil capillaire, paiement Wero/PayPal, espace organisatrice).
- `render.yaml` : un fichier de configuration qui dit à Render exactement quoi créer (le site + la base de données), pour éviter de tout régler à la main.

Code d'accès à l'espace organisatrice : **38L-YRkLfziplGFf** (déjà préconfiguré dans `render.yaml`).

## Étape 1 — Mettre le code sur GitHub

1. Allez sur [github.com/new](https://github.com/new) et créez un nouveau dépôt (par exemple `fimani-quiz`). Laissez-le vide (sans README).
2. Sur la page du dépôt vide, cliquez sur **« uploading an existing file »**.
3. Glissez-déposez TOUS les fichiers et dossiers de ce paquet (y compris le dossier `public` en entier) dans la zone d'upload. GitHub garde l'organisation des dossiers.
4. Cliquez sur **Commit changes**.

## Étape 2 — Déployer sur Render

1. Allez sur [dashboard.render.com](https://dashboard.render.com), connectez-vous (ou créez un compte gratuit).
2. Cliquez sur **New +** → **Blueprint**.
3. Connectez votre compte GitHub si ce n'est pas déjà fait, puis choisissez le dépôt `fimani-quiz` que vous venez de créer.
4. Render détecte automatiquement le fichier `render.yaml` et propose de créer : un site web (`fimani-quiz`) et une base de données (`fimani-quiz-db`). Cliquez sur **Apply** / **Create**.
5. Le premier déploiement prend quelques minutes. Une fois terminé, Render vous donne une adresse du type `https://fimani-quiz.onrender.com` — c'est votre page, fonctionnelle et publique.

⚠️ Avec le plan gratuit de Render, le site peut se mettre en veille après 15 minutes sans visite et met alors ~30 secondes à se relancer à la prochaine visite. Si c'est gênant pour l'atelier, un plan payant (quelques dollars/mois) supprime cette veille.

## Étape 3 — Relier votre nom de domaine IONOS (optionnel)

Une fois le site en ligne sur Render :
1. Dans Render, ouvrez le service `fimani-quiz` → onglet **Settings** → **Custom Domains** → **Add Custom Domain**.
2. Entrez votre domaine (ex. `monatelierfimani.fr`). Render vous donne un enregistrement DNS à créer (un `CNAME`, ou des adresses `A`/`ALIAS` pour le domaine racine).
3. Allez dans votre espace IONOS → DNS de votre domaine → ajoutez l'enregistrement indiqué par Render.
4. Attendez la propagation (quelques minutes à quelques heures) : votre domaine affichera directement le site, sans redirection.

## Si vous êtes bloquée

Dites-le-moi à n'importe quelle étape (message d'erreur, capture d'écran) et je vous aide à débloquer la situation.
