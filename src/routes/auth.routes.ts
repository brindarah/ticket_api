import { Router } from "express";
import { validate } from "../middlewares/validate";
import { authenticate } from "../middlewares/auth";
import {
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../schemas/auth.schema";
import {
  login,
  refresh,
  logout,
  me,
  forgotPassword,
  resetPassword,
} from "../controllers/auth.controller";

const router = Router();

router.post("/login", validate(loginSchema, "body"), login);
router.post("/refresh", validate(refreshSchema, "body"), refresh);
router.post("/logout", validate(refreshSchema, "body"), logout);
router.get("/me", authenticate, me);
router.post("/forgot-password", validate(forgotPasswordSchema, "body"), forgotPassword);
router.post("/reset-password", validate(resetPasswordSchema, "body"), resetPassword);

export default router;