import { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } from "../middlewares/rateLimit";
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

router.post("/login", loginLimiter, validate(loginSchema, "body"), login);
router.post("/refresh", validate(refreshSchema, "body"), refresh);
router.post("/logout", validate(refreshSchema, "body"), logout);
router.get("/me", authenticate, me);
router.post("/forgot-password", forgotPasswordLimiter, validate(forgotPasswordSchema, "body"), forgotPassword);
router.post("/reset-password", resetPasswordLimiter, validate(resetPasswordSchema, "body"), resetPassword);

export default router;