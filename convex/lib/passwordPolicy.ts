/**
 * The account password rule, shared by the auth provider (which enforces it on
 * sign-up and reset) and the sign-in form (which states it before submitting).
 * One constant so the form can never accept a password the server refuses.
 *
 * @license GPL-3.0-only
 */

import { ConvexError } from "convex/values";

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Raised by the provider when a new password breaks the rule. A ConvexError,
 * so the reason reaches the client instead of being redacted to a generic
 * server error.
 */
export const PASSWORD_TOO_SHORT = "PasswordTooShort";

export function validatePasswordRequirements(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new ConvexError(PASSWORD_TOO_SHORT);
}
