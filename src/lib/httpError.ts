// Code d'erreur par défaut selon le statut HTTP
const DEFAULT_CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  429: "TOO_MANY_REQUESTS",
};

export function defaultErrorCode(statusCode: number): string {
  return DEFAULT_CODES[statusCode] ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "ERROR");
}

// Erreur avec un code HTTP, attrapée par errorHandler.
// Le code est déduit du statut si on ne le précise pas :
//   throw new HttpError(404, "User not found")            -> code "NOT_FOUND"
//   throw new HttpError(409, "...", "EMAIL_ALREADY_USED") -> code personnalisé
export class HttpError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code?: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code ?? defaultErrorCode(statusCode);
    this.details = details;
  }
}