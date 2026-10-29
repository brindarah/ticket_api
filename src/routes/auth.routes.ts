import { Router } from "express";
import { validate } from "../middlewares/validate";
import { loginSchema } from "../schemas/auth.schema";
import { login } from "../controllers/auth.controller";

const router = Router();

router.post("/login", validate(loginSchema, "body"), login);

export default router;