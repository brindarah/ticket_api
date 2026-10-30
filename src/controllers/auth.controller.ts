import { Request, Response } from "express";
import * as authService from "../services/auth.service";
import type {
  LoginInput,
  RefreshInput,
  ForgotPasswordInput,
  ResetPasswordInput,
} from "../schemas/auth.schema";

// POST /auth/login
export const login = async (_req: Request, res: Response) => {
  const { email, password } = res.locals.body as LoginInput;
  res.json(await authService.loginUser(email, password));
};

// POST /auth/refresh
export const refresh = async (_req: Request, res: Response) => {
  const { refreshToken } = res.locals.body as RefreshInput;
  res.json(await authService.refreshSession(refreshToken));
};

// POST /auth/logout
export const logout = async (_req: Request, res: Response) => {
  const { refreshToken } = res.locals.body as RefreshInput;
  await authService.logoutSession(refreshToken);
  // 204 = succès, sans contenu à renvoyer
  res.status(204).send();
};

// GET /auth/me (protégée par authenticate)
export const me = async (_req: Request, res: Response) => {
  const user = await authService.getCurrentUser(res.locals.user.id);
  res.json({ user });
};

// POST /auth/forgot-password
export const forgotPassword = async (_req: Request, res: Response) => {
  const { email } = res.locals.body as ForgotPasswordInput;
  await authService.requestPasswordReset(email);
  // Toujours la même réponse, que le compte existe ou non
  res.json({ message: "If this account exists, a reset email has been sent" });
};

// POST /auth/reset-password
export const resetPassword = async (_req: Request, res: Response) => {
  const { token, password } = res.locals.body as ResetPasswordInput;
  await authService.resetPassword(token, password);
  res.json({ message: "Password updated" });
};