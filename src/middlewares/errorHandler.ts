import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "../lib/httpError";

// Format unique de toutes les erreurs de l'API :
// { "error": "message lisible", "code": "CODE_MACHINE", "details": ... (facultatif) }
type ErrorBody = {
  error: string;
  code: string;
  details?: unknown;
};

const sendError = (res: Response, status: number, body: ErrorBody) =>
  res.status(status).json(body);

const hasStringField = (err: unknown, field: string): err is Record<string, string> =>
  typeof err === "object" && err !== null && field in err &&
  typeof (err as Record<string, unknown>)[field] === "string";

// Route qui n'existe pas
export const notFound = (req: Request, res: Response) => {
  sendError(res, 404, {
    error: `Route ${req.method} ${req.originalUrl} not found`,
    code: "ROUTE_NOT_FOUND",
  });
};

// Toutes les erreurs de l'application arrivent ici
export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Données invalides (Zod)
  if (err instanceof ZodError) {
    return sendError(res, 400, {
      error: "Validation failed",
      code: "VALIDATION_ERROR",
      details: err.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  // Erreurs lancées volontairement dans le code (401, 403, 404...)
  if (err instanceof HttpError) {
    return sendError(res, err.statusCode, {
      error: err.message,
      code: err.code,
      ...(err.details !== undefined && { details: err.details }),
    });
  }

  // Erreurs de lecture du body (express.json)
  if (hasStringField(err, "type")) {
    if (err.type === "entity.parse.failed") {
      return sendError(res, 400, { error: "Invalid JSON body", code: "INVALID_JSON" });
    }
    if (err.type === "entity.too.large") {
      return sendError(res, 413, { error: "Request body too large", code: "PAYLOAD_TOO_LARGE" });
    }
  }

  // Erreurs Prisma connues
  if (hasStringField(err, "code")) {
    // Élément introuvable lors d'une mise à jour (utilisé par les tickets)
    if (err.code === "P2025") {
      return sendError(res, 404, { error: "Ticket not found", code: "NOT_FOUND" });
    }
    // Valeur unique déjà utilisée (email...)
    if (err.code === "P2002") {
      return sendError(res, 409, { error: "Resource already exists", code: "CONFLICT" });
    }
  }

  // Tout le reste : erreur serveur, sans détail technique pour le client
  console.error(err);
  return sendError(res, 500, { error: "Internal server error", code: "INTERNAL_ERROR" });
};