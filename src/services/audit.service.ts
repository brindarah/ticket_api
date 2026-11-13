import { prisma } from "../lib/prisma";
import type { AuditAction, AuditEntityType } from "../generated/prisma/enums";

// Valeurs simples uniquement (ex. { status: "OPEN" }).
// Ne jamais y mettre de mot de passe, JWT, refresh token, jeton d'invitation ou secret.
export type AuditValue = Record<string, string | number | boolean | null>;

export type AuditEntry = {
  actorId: string | null; // null : action système (seed), sinon l'utilisateur connecté
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  oldValue?: AuditValue;
  newValue?: AuditValue;
};

// Écrit une entrée d'audit. À appeler avec le client de la transaction de l'opération
// métier : si l'opération échoue, l'audit est annulé avec elle.
export function recordAudit(tx: Pick<typeof prisma, "auditLog">, entry: AuditEntry) {
  return tx.auditLog.create({ data: entry });
}
