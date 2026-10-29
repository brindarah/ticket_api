import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

// Route qui n'existe pas
export const notFound = (req: Request, res: Response) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
};

// Toutes les erreurs de l'application arrivent ici
export const errorHandler = (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Données invalides (Zod)
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "Validation failed",
      details: err.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  // JSON mal formé dans le body
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  // Ticket introuvable lors d'une mise à jour (erreur Prisma P2025)
  if (typeof err === "object" && err !== null && "code" in err && err.code === "P2025") {
    return res.status(404).json({ error: "Ticket not found" });
  }

  // Tout le reste : erreur serveur
  console.error(err);
  return res.status(500).json({ error: "Internal server error" });
};
