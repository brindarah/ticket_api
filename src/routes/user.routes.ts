import { Router } from "express";
import { validate } from "../middlewares/validate";
import { authenticate, authorize } from "../middlewares/auth";
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserStatusSchema,
  userIdParamsSchema,
} from "../schemas/user.schema";
import { createUser, listUsers, resendInvitation, updateUserStatus } from "../controllers/user.controller";

const router = Router();

// Toutes les routes /users sont réservées au Super Admin
router.use(authenticate, authorize("SUPER_ADMIN"));

router.post("/", validate(createUserSchema, "body"), createUser);
router.get("/", validate(listUsersQuerySchema, "query"), listUsers);
router.post("/:id/invitation", validate(userIdParamsSchema, "params"), resendInvitation);
router.patch(
  "/:id/status",
  validate(userIdParamsSchema, "params"),
  validate(updateUserStatusSchema, "body"),
  updateUserStatus,
);

export default router;
