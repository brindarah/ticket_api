import { Router } from "express";
import { validate } from "../middlewares/validate";
import { loginSchema, refreshSchema } from "../schemas/auth.schema";
import { login, refresh, logout } from "../controllers/auth.controller";

const router = Router();

router.post("/login", validate(loginSchema, "body"), login);
router.post("/refresh", validate(refreshSchema, "body"), refresh);
router.post("/logout", validate(refreshSchema, "body"), logout);

export default router;