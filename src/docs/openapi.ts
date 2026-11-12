// Documentation OpenAPI de l'API, servie par Swagger UI sur /docs (JSON brut : /docs/openapi.json).
// Elle décrit uniquement les routes réellement montées dans app.ts.
// À mettre à jour à chaque ajout ou modification de route : le test tests/openapi.test.ts
// vérifie que chaque route Express est documentée et que chaque route documentée existe.

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const response = (name: string) => ({ $ref: `#/components/responses/${name}` });
const json = (schema: object, example?: object) => ({
  content: { "application/json": { schema, ...(example && { example }) } },
});
const body = (schema: object, example?: object) => ({ required: true, ...json(schema, example) });
const messageResponse = (description: string, message: string) => ({
  description,
  ...json(ref("Message"), { message }),
});
const errorExample = (description: string, error: string) => ({ description, ...json(ref("Error"), { error }) });

const uuidPath = (description: string) => ({
  name: "id",
  in: "path",
  required: true,
  description,
  schema: { type: "string", format: "uuid" },
});

const pageParams = [
  { name: "page", in: "query", description: "Numéro de page (≥ 1)", schema: { type: "integer", minimum: 1, default: 1 } },
  {
    name: "limit",
    in: "query",
    description: "Nombre de résultats par page (1 à 100 ; au-delà : 400)",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 10 },
  },
];

// Mot de passe choisi par l'utilisateur
const newPassword = { type: "string", minLength: 8, format: "password" };

const bearer = [{ bearerAuth: [] }];

export const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Support Ticket API",
    version: "1.0.0",
    description: [
      "API REST de gestion de tickets de support, sans frontend.",
      "",
      "**Authentification** : `Authorization: Bearer <accessToken>`, obtenu avec `POST /auth/login`.",
      "L'access token (JWT) est valable 15 minutes par défaut ; `POST /auth/refresh` en délivre un nouveau.",
      "Le compte doit être `ACTIVE` : un compte désactivé est refusé dès la requête suivante (401).",
      "",
      "**Rôles** : `USER` et `SUPER_ADMIN`. Les routes `/users` sont réservées au `SUPER_ADMIN`.",
      "",
      "**Erreurs** : le corps est `{ \"error\": \"message\" }`. Les erreurs de validation (400)",
      "ajoutent `details`, la liste des champs invalides. Un JSON mal formé renvoie 400 `Invalid JSON body`,",
      "une route inconnue 404, une erreur inattendue 500 `Internal server error`.",
    ].join("\n"),
  },
  tags: [
    { name: "Health", description: "État du serveur" },
    { name: "Tickets", description: "Tickets de support (utilisateur connecté)" },
    { name: "Authentification", description: "Connexion, sessions et mot de passe" },
    { name: "Invitations", description: "Activation d'un compte invité" },
    { name: "Utilisateurs", description: "Gestion des utilisateurs (SUPER_ADMIN)" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Vérifier que le serveur fonctionne",
        security: [],
        responses: { 200: { description: "Serveur disponible", ...json(ref("Health"), { status: "ok" }) } },
      },
    },

    "/tickets": {
      post: {
        tags: ["Tickets"],
        summary: "Créer un ticket",
        description:
          "Tout utilisateur connecté peut créer un ticket. L'auteur (`createdById`) est l'utilisateur du JWT : " +
          "le body n'accepte que `title` et `description`, tout autre champ (`email`, `createdById`, `status`…) est refusé (400).",
        security: bearer,
        requestBody: body(ref("CreateTicketInput"), {
          title: "Impossible de se connecter",
          description: "La connexion échoue depuis ce matin.",
        }),
        responses: {
          201: { description: "Ticket créé, statut OPEN", ...json(ref("Ticket")) },
          400: response("ValidationError"),
          401: response("Unauthorized"),
          500: response("InternalError"),
        },
      },
      get: {
        tags: ["Tickets"],
        summary: "Lister les tickets",
        description:
          "Tous les utilisateurs connectés voient tous les tickets correspondant aux filtres. " +
          "Tri : liste blanche de champs ; en cas d'égalité, l'id sert de second critère pour une pagination stable. " +
          "Le tri par `status` suit l'ordre de l'enum : OPEN, IN_PROGRESS, RESOLVED, CLOSED.",
        security: bearer,
        parameters: [
          { name: "status", in: "query", description: "Filtrer par statut", schema: ref("TicketStatus") },
          ...pageParams,
          {
            name: "sort",
            in: "query",
            description: "Champ de tri",
            schema: { type: "string", enum: ["createdAt", "updatedAt", "title", "status"], default: "createdAt" },
          },
          {
            name: "order",
            in: "query",
            description: "Ordre de tri",
            schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
          },
        ],
        responses: {
          200: { description: "Page de tickets", ...json(ref("TicketList")) },
          400: response("ValidationError"),
          401: response("Unauthorized"),
          500: response("InternalError"),
        },
      },
    },

    "/tickets/{id}": {
      get: {
        tags: ["Tickets"],
        summary: "Consulter un ticket",
        description: "Tout utilisateur connecté peut consulter un ticket, même s'il ne l'a pas créé.",
        security: bearer,
        parameters: [uuidPath("Identifiant du ticket")],
        responses: {
          200: { description: "Le ticket", ...json(ref("Ticket")) },
          400: response("ValidationError"),
          401: response("Unauthorized"),
          404: errorExample("Ticket introuvable", "Ticket not found"),
          500: response("InternalError"),
        },
      },
    },

    "/tickets/{id}/status": {
      patch: {
        tags: ["Tickets"],
        summary: "Modifier le statut d'un ticket",
        description:
          "Autorisé au créateur du ticket et au `SUPER_ADMIN`. Les droits sont vérifiés côté serveur à partir du JWT. " +
          "Envoyer le statut actuel ne modifie rien (200). Chaque changement effectif est enregistré dans le journal d'audit.",
        security: bearer,
        parameters: [uuidPath("Identifiant du ticket")],
        requestBody: body(ref("UpdateTicketStatusInput"), { status: "IN_PROGRESS" }),
        responses: {
          200: { description: "Ticket mis à jour", ...json(ref("Ticket")) },
          400: response("ValidationError"),
          401: response("Unauthorized"),
          403: errorExample(
            "L'utilisateur n'est ni le créateur ni SUPER_ADMIN",
            "You can only change the status of your own tickets",
          ),
          404: errorExample("Ticket introuvable", "Ticket not found"),
          409: errorExample(
            "Le statut a été modifié par une autre requête au même moment : réessayer",
            "The ticket status was changed by another request, please retry",
          ),
          500: response("InternalError"),
        },
      },
    },

    "/auth/login": {
      post: {
        tags: ["Authentification"],
        summary: "Se connecter",
        description: "L'email est comparé sans tenir compte de la casse.",
        security: [],
        requestBody: body(ref("LoginInput"), { email: "awa@example.com", password: "motdepasse" }),
        responses: {
          200: { description: "Connexion réussie", ...json(ref("LoginResponse")) },
          400: response("ValidationError"),
          401: errorExample(
            "Email inconnu, mot de passe faux ou compte invité sans mot de passe (même message)",
            "Invalid email or password",
          ),
          403: errorExample("Compte désactivé", "Account disabled"),
          500: response("InternalError"),
        },
      },
    },

    "/auth/refresh": {
      post: {
        tags: ["Authentification"],
        summary: "Renouveler les tokens",
        description:
          "Rotation : le refresh token envoyé est révoqué et une nouvelle paire est délivrée. " +
          "Réutiliser un refresh token déjà révoqué révoque toutes les sessions de l'utilisateur.",
        security: [],
        requestBody: body(ref("RefreshInput")),
        responses: {
          200: { description: "Nouvelle paire de tokens", ...json(ref("TokenPair")) },
          400: response("ValidationError"),
          401: errorExample("Refresh token inconnu, révoqué ou expiré", "Invalid refresh token"),
          403: errorExample("Compte désactivé", "Account disabled"),
          500: response("InternalError"),
        },
      },
    },

    "/auth/logout": {
      post: {
        tags: ["Authentification"],
        summary: "Se déconnecter",
        description: "Révoque le refresh token. Répond 204 même si le token est inconnu.",
        security: [],
        requestBody: body(ref("RefreshInput")),
        responses: {
          204: { description: "Déconnecté" },
          400: response("ValidationError"),
          500: response("InternalError"),
        },
      },
    },

    "/auth/me": {
      get: {
        tags: ["Authentification"],
        summary: "Utilisateur connecté",
        security: bearer,
        responses: {
          200: {
            description: "Profil de l'utilisateur connecté",
            ...json({ type: "object", required: ["user"], properties: { user: ref("User") } }),
          },
          401: response("Unauthorized"),
          404: errorExample("Utilisateur introuvable", "User not found"),
          500: response("InternalError"),
        },
      },
    },

    "/auth/forgot-password": {
      post: {
        tags: ["Authentification"],
        summary: "Demander la réinitialisation du mot de passe",
        description:
          "Si un compte ACTIVE correspond, un jeton valable 60 minutes est envoyé par email. " +
          "La réponse est identique que le compte existe ou non, et que l'email parte ou non.",
        security: [],
        requestBody: body(ref("ForgotPasswordInput")),
        responses: {
          200: messageResponse("Demande prise en compte", "If this account exists, a reset email has been sent"),
          400: response("ValidationError"),
          500: response("InternalError"),
        },
      },
    },

    "/auth/reset-password": {
      post: {
        tags: ["Authentification"],
        summary: "Réinitialiser le mot de passe",
        description: "Jeton reçu par email, à usage unique. Toutes les sessions de l'utilisateur sont ensuite révoquées.",
        security: [],
        requestBody: body(ref("ResetPasswordInput")),
        responses: {
          200: messageResponse("Mot de passe modifié", "Password updated"),
          400: {
            description: "Données invalides, ou jeton inconnu, expiré ou déjà utilisé (`Invalid or expired token`)",
            ...json({ oneOf: [ref("ValidationErrorBody"), ref("Error")] }),
          },
          500: response("InternalError"),
        },
      },
    },

    "/auth/accept-invitation": {
      post: {
        tags: ["Invitations"],
        summary: "Accepter une invitation",
        description:
          "Route publique : le jeton reçu par email sert de preuve. Le mot de passe est enregistré et le compte devient ACTIVE. " +
          "L'utilisateur se connecte ensuite avec `POST /auth/login`. Jeton à usage unique.",
        security: [],
        requestBody: body(ref("AcceptInvitationInput")),
        responses: {
          200: {
            description: "Compte activé",
            ...json({
              type: "object",
              required: ["message", "user"],
              properties: { message: { type: "string", example: "Invitation accepted" }, user: ref("User") },
            }),
          },
          400: {
            description:
              "Données invalides, ou jeton inconnu, expiré, déjà utilisé ou compte non INVITED (`Invalid or expired invitation`)",
            ...json({ oneOf: [ref("ValidationErrorBody"), ref("Error")] }),
          },
          500: response("InternalError"),
        },
      },
    },

    "/users": {
      post: {
        tags: ["Utilisateurs"],
        summary: "Créer un utilisateur et l'inviter",
        description:
          "**SUPER_ADMIN.** Crée un utilisateur `USER` au statut `INVITED` et lui envoie une invitation valable 72 heures. " +
          "Le rôle et le statut ne sont pas choisis par le client. Si l'email échoue, l'utilisateur reste créé (201) " +
          "et `invitation.emailStatus` vaut `failed` : renvoyer l'invitation avec `POST /users/{id}/invitation`.",
        security: bearer,
        requestBody: body(ref("CreateUserInput"), { nom: "Diallo", prenom: "Awa", email: "awa@example.com" }),
        responses: {
          201: {
            description: "Utilisateur créé",
            ...json({
              type: "object",
              required: ["user", "invitation"],
              properties: { user: ref("User"), invitation: ref("InvitationResult") },
            }),
          },
          400: response("ValidationError"),
          401: response("Unauthorized"),
          403: response("Forbidden"),
          409: errorExample("Email déjà utilisé (quelle que soit la casse)", "A user with this email already exists"),
          500: response("InternalError"),
        },
      },
      get: {
        tags: ["Utilisateurs"],
        summary: "Lister les utilisateurs",
        description: "**SUPER_ADMIN.** Liste paginée, triée par date de création décroissante. Le mot de passe n'est jamais renvoyé.",
        security: bearer,
        parameters: [
          { name: "status", in: "query", description: "Filtrer par statut", schema: ref("UserStatus") },
          { name: "role", in: "query", description: "Filtrer par rôle", schema: ref("Role") },
          ...pageParams,
        ],
        responses: {
          200: { description: "Page d'utilisateurs", ...json(ref("UserList")) },
          400: response("ValidationError"),
          401: response("Unauthorized"),
          403: response("Forbidden"),
          500: response("InternalError"),
        },
      },
    },

    "/users/{id}/invitation": {
      post: {
        tags: ["Utilisateurs"],
        summary: "Renvoyer une invitation",
        description: "**SUPER_ADMIN.** Les invitations encore valides expirent ; une nouvelle est créée et envoyée.",
        security: bearer,
        parameters: [uuidPath("Identifiant de l'utilisateur")],
        responses: {
          201: {
            description: "Nouvelle invitation",
            ...json({ type: "object", required: ["invitation"], properties: { invitation: ref("InvitationResult") } }),
          },
          400: response("ValidationError"),
          401: response("Unauthorized"),
          403: response("Forbidden"),
          404: errorExample("Utilisateur introuvable", "User not found"),
          409: errorExample(
            "L'utilisateur n'est pas au statut INVITED",
            "Only users with status INVITED can receive a new invitation",
          ),
          500: response("InternalError"),
        },
      },
    },

    "/users/{id}/status": {
      patch: {
        tags: ["Utilisateurs"],
        summary: "Activer ou désactiver un utilisateur",
        description:
          "**SUPER_ADMIN.** `DISABLED` : révoque les sessions et fait expirer les invitations en attente. " +
          "`ACTIVE` : réactive un compte désactivé (il redevient ACTIVE s'il a un mot de passe, sinon INVITED). " +
          "Demander le statut actuel ne modifie rien. Les désactivations et réactivations sont enregistrées dans le journal d'audit.",
        security: bearer,
        parameters: [uuidPath("Identifiant de l'utilisateur")],
        requestBody: body(ref("UpdateUserStatusInput"), { status: "DISABLED" }),
        responses: {
          200: {
            description: "Utilisateur après modification",
            ...json({ type: "object", required: ["user"], properties: { user: ref("User") } }),
          },
          400: response("ValidationError"),
          401: response("Unauthorized"),
          403: {
            description:
              "Pas SUPER_ADMIN (`Forbidden`), modification de son propre statut (`You cannot change your own status`) " +
              "ou d'un autre SUPER_ADMIN (`The status of a Super Admin cannot be changed`)",
            ...json(ref("Error")),
          },
          404: errorExample("Utilisateur introuvable", "User not found"),
          409: errorExample(
            "Un utilisateur INVITED s'active en acceptant son invitation",
            "An invited user is activated by accepting the invitation",
          ),
          500: response("InternalError"),
        },
      },
    },
  },

  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    },

    responses: {
      ValidationError: {
        description: "Données invalides (body, paramètres ou query), ou JSON mal formé (`Invalid JSON body`)",
        ...json(ref("ValidationErrorBody"), {
          error: "Validation failed",
          details: [{ field: "title", message: "Le titre doit faire au moins 3 caractères" }],
        }),
      },
      Unauthorized: {
        description: "Token absent (`Authentication required`), invalide, expiré, ou compte non ACTIVE (`Invalid or expired token`)",
        ...json(ref("Error"), { error: "Authentication required" }),
      },
      Forbidden: errorExample("Rôle insuffisant : SUPER_ADMIN requis", "Forbidden"),
      InternalError: errorExample("Erreur inattendue du serveur", "Internal server error"),
    },

    schemas: {
      Health: { type: "object", properties: { status: { type: "string", example: "ok" } } },
      Error: { type: "object", required: ["error"], properties: { error: { type: "string" } } },
      ValidationErrorBody: {
        type: "object",
        required: ["error", "details"],
        properties: {
          error: { type: "string", example: "Validation failed" },
          details: {
            type: "array",
            items: {
              type: "object",
              required: ["field", "message"],
              properties: { field: { type: "string" }, message: { type: "string" } },
            },
          },
        },
      },
      Message: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
      PaginationMeta: {
        type: "object",
        required: ["total", "page", "limit", "totalPages"],
        properties: {
          total: { type: "integer", example: 42 },
          page: { type: "integer", example: 1 },
          limit: { type: "integer", example: 10 },
          totalPages: { type: "integer", example: 5 },
        },
      },

      TicketStatus: { type: "string", enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] },
      Role: { type: "string", enum: ["SUPER_ADMIN", "USER"] },
      UserStatus: { type: "string", enum: ["INVITED", "ACTIVE", "DISABLED"] },

      TicketAuthor: {
        type: "object",
        description: "Auteur du ticket. Son email n'est jamais renvoyé.",
        required: ["id", "nom", "prenom"],
        properties: { id: { type: "string", format: "uuid" }, nom: { type: "string" }, prenom: { type: "string" } },
      },
      Ticket: {
        type: "object",
        required: ["id", "title", "description", "status", "createdAt", "updatedAt", "createdById", "createdBy"],
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          description: { type: "string" },
          status: ref("TicketStatus"),
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          createdById: { type: "string", format: "uuid" },
          createdBy: ref("TicketAuthor"),
        },
      },
      TicketList: {
        type: "object",
        required: ["data", "meta"],
        properties: { data: { type: "array", items: ref("Ticket") }, meta: ref("PaginationMeta") },
      },
      CreateTicketInput: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description"],
        properties: {
          title: { type: "string", minLength: 3, maxLength: 200 },
          description: { type: "string", minLength: 1 },
        },
      },
      UpdateTicketStatusInput: {
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: { status: ref("TicketStatus") },
      },

      User: {
        type: "object",
        description: "Utilisateur, sans mot de passe ni jeton",
        required: ["id", "nom", "prenom", "email", "role", "status", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          nom: { type: "string" },
          prenom: { type: "string" },
          email: { type: "string", format: "email" },
          role: ref("Role"),
          status: ref("UserStatus"),
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      UserList: {
        type: "object",
        required: ["data", "meta"],
        properties: { data: { type: "array", items: ref("User") }, meta: ref("PaginationMeta") },
      },
      CreateUserInput: {
        type: "object",
        required: ["nom", "prenom", "email"],
        properties: {
          nom: { type: "string", minLength: 1, maxLength: 100 },
          prenom: { type: "string", minLength: 1, maxLength: 100 },
          email: { type: "string", format: "email" },
        },
      },
      UpdateUserStatusInput: {
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: { status: { type: "string", enum: ["ACTIVE", "DISABLED"] } },
      },
      InvitationResult: {
        type: "object",
        required: ["expiresAt", "emailStatus"],
        properties: {
          expiresAt: { type: "string", format: "date-time" },
          emailStatus: {
            type: "string",
            enum: ["accepted_by_provider", "failed"],
            description: "`accepted_by_provider` : Resend a accepté l'email (livraison non confirmée)",
          },
          message: { type: "string", description: "Présent seulement si emailStatus vaut failed" },
        },
      },

      LoginInput: {
        type: "object",
        required: ["email", "password"],
        properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password" } },
      },
      LoginResponse: {
        type: "object",
        required: ["accessToken", "refreshToken", "user"],
        properties: {
          accessToken: { type: "string", description: "JWT à envoyer dans Authorization: Bearer" },
          refreshToken: { type: "string" },
          user: {
            type: "object",
            properties: {
              id: { type: "string", format: "uuid" },
              nom: { type: "string" },
              prenom: { type: "string" },
              email: { type: "string", format: "email" },
              role: ref("Role"),
            },
          },
        },
      },
      TokenPair: {
        type: "object",
        required: ["accessToken", "refreshToken"],
        properties: { accessToken: { type: "string" }, refreshToken: { type: "string" } },
      },
      RefreshInput: {
        type: "object",
        required: ["refreshToken"],
        properties: { refreshToken: { type: "string", minLength: 1 } },
      },
      ForgotPasswordInput: {
        type: "object",
        required: ["email"],
        properties: { email: { type: "string", format: "email" } },
      },
      ResetPasswordInput: {
        type: "object",
        required: ["token", "password"],
        properties: { token: { type: "string", minLength: 1 }, password: newPassword },
      },
      AcceptInvitationInput: {
        type: "object",
        additionalProperties: false,
        required: ["token", "password"],
        properties: {
          token: { type: "string", minLength: 1 },
          password: { ...newPassword, description: "8 caractères minimum, 72 octets maximum" },
        },
      },
    },
  },
};
