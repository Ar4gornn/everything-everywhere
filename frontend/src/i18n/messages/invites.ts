import type { Entry } from "../catalogue";

/** AD-54: issuing invites from the app, for an admin. */
export const invites = {
  "invites.title": { en: "Invites", fr: "Invitations" },
  "invites.settingsTitle": { en: "Invite someone", fr: "Inviter quelqu’un" },
  "invites.settingsHint": {
    en: "Registration here is by invitation. Issue a single-use code and send the link.",
    fr: "L’inscription se fait sur invitation. Créez un code à usage unique et envoyez le lien.",
  },
  "invites.open": { en: "Open invites", fr: "Ouvrir les invitations" },
  "invites.new": { en: "New invite", fr: "Nouvelle invitation" },
  "invites.note": { en: "Who it is for", fr: "Pour qui" },
  "invites.noteHint": {
    en: "For your own records. The person you invite never sees it.",
    fr: "Pour vos propres notes. La personne invitée ne le voit jamais.",
  },
  "invites.days": { en: "Valid for (days)", fr: "Valable (jours)" },
  "invites.create": { en: "Create invite", fr: "Créer l’invitation" },
  "invites.message": { en: "Message to send", fr: "Message à envoyer" },
  "invites.onceOnly": {
    en: "The code is shown this once. Only its hash is kept, so copy the message now. Anyone holding the link can create one account.",
    fr: "Le code n’est affiché qu’une fois : seule son empreinte est conservée, copiez donc le message maintenant. Quiconque a le lien peut créer un compte.",
  },
  "invites.messageBody": {
    en: "Hi! I’ve invited you to Everything Everywhere, the app I use to keep track of budget, habits and more.\n\nCreate your account here:\n{link}\n\nThe link works once and expires on {date}.",
    fr: "Salut ! Je t’invite sur Everything Everywhere, l’appli que j’utilise pour suivre mon budget, mes habitudes et plus encore.\n\nCrée ton compte ici :\n{link}\n\nLe lien ne fonctionne qu’une fois et expire le {date}.",
  },
  "invites.copy": { en: "Copy message", fr: "Copier le message" },
  "invites.copied": { en: "Message copied", fr: "Message copié" },
  "invites.couldNotCopy": {
    en: "Could not copy. Select the message and copy it by hand.",
    fr: "Copie impossible. Sélectionnez le message et copiez-le vous-même.",
  },
  "invites.share": { en: "Share…", fr: "Partager…" },
  "invites.issued": { en: "Issued", fr: "Émises" },
  "invites.none": { en: "No invites issued yet.", fr: "Aucune invitation pour l’instant." },
  "invites.noNote": { en: "(no note)", fr: "(sans note)" },
  "invites.stateOpen": { en: "Open until {date}", fr: "Ouverte jusqu’au {date}" },
  "invites.stateUsed": { en: "Used {date}", fr: "Utilisée le {date}" },
  "invites.stateExpired": { en: "Ended {date}", fr: "Terminée le {date}" },
  "invites.revoke": { en: "Revoke", fr: "Révoquer" },
  "invites.revoked": { en: "Invite revoked", fr: "Invitation révoquée" },
  "invites.couldNotLoad": {
    en: "Could not load the invites.",
    fr: "Impossible de charger les invitations.",
  },
  "invites.couldNotCreate": {
    en: "Could not create the invite.",
    fr: "Impossible de créer l’invitation.",
  },
  "invites.couldNotRevoke": {
    en: "Could not revoke the invite.",
    fr: "Impossible de révoquer l’invitation.",
  },
} satisfies Record<string, Entry>;
