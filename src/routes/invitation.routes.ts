import { Router } from "express";
import { validate } from "../middlewares/validate";
import { acceptInvitationSchema } from "../schemas/invitation.schema";
import { acceptInvitation } from "../controllers/invitation.controller";

// Monté sur /auth, à côté des routes d'authentification de Personne 1 (auth.routes.ts)
const router = Router();

router.post("/accept-invitation", validate(acceptInvitationSchema, "body"), acceptInvitation);

export default router;
