export function validEmail(email: string | null | undefined): boolean {
  if (!email || email === "Not Publicly Listed") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

// Normalises to E.164 digits (no leading +), default country India (91).
export function normPhone(phone: string | null | undefined): string {
  if (!phone || phone === "Not Publicly Listed") return "";
  let digits = String(phone).replace(/\D/g, "");
  if (digits.length === 10) digits = "91" + digits;
  return digits.length >= 11 && digits.length <= 13 ? digits : "";
}
