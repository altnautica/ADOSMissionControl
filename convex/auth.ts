import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { validatePasswordRequirements } from "./lib/passwordPolicy";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password({ validatePasswordRequirements })],
});
