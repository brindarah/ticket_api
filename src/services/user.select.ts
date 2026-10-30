// Champs d'un utilisateur renvoyés au client : jamais le mot de passe ni les jetons
export const publicUserSelect = {
  id: true,
  nom: true,
  prenom: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;
