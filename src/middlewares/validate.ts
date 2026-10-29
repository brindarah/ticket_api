import { NextFunction, Request, Response } from "express";
import { ZodType } from "zod";

// Vérifie req.body, req.query ou req.params avec un schéma Zod.
// Si c'est valide, les données nettoyées sont rangées dans res.locals.
// Sinon, Zod lève une erreur qui part dans errorHandler.
export const validate =
  (schema: ZodType, source: "body" | "query" | "params" = "body") =>
  (req: Request, res: Response, next: NextFunction) => {
    res.locals[source] = schema.parse(req[source]);
    next();
  };
