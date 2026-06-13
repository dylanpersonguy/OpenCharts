/** Password strength rules — must match the server-side registerSchema / changePasswordSchema */

export interface PasswordValidationResult {
  valid: boolean;
  message: string | null;
}

export function validatePasswordStrength(password: string): PasswordValidationResult {
  if (password.length < 8) {
    return { valid: false, message: "Password must be at least 8 characters" };
  }
  if (password.length > 128) {
    return { valid: false, message: "Password must be at most 128 characters" };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one uppercase letter" };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one lowercase letter" };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one number" };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one special character (e.g. !@#$%)" };
  }
  return { valid: true, message: null };
}
