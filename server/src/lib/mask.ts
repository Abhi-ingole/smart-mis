/**
 * Privacy masking applied to every piece of text before it is sent to the AI.
 * Phone numbers and email addresses are replaced; counts are left alone.
 */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// International numbers with a leading +, e.g. +91 98765 43210, +1-415-555-0100
const INTL_PHONE_RE = /\+\d{1,3}[\s.-]?(?:\(?\d{1,5}\)?[\s.-]?){1,4}\d{2,5}/g;
// Indian mobiles: optional 0/91 prefix, 10 digits starting 6–9, optionally split 5+5
const IN_MOBILE_RE = /(?<![\d,.])(?:(?:0|91)[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?![\d,.])/g;
// Any other bare run of 11–15 digits (long numbers, landlines with STD code)
const LONG_DIGITS_RE = /(?<![\d,.])\d{11,15}(?![\d,.])/g;

export function maskPII(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(INTL_PHONE_RE, "[phone]")
    .replace(IN_MOBILE_RE, "[phone]")
    .replace(LONG_DIGITS_RE, "[phone]");
}

/** Column names that hold personal data and are dropped entirely from spreadsheets. */
export const PII_COLUMN_RE = /(phone|mobile|msisdn|whatsapp\s*(no|number)|contact|e-?mail|address|name|recipient\s*(id|number)|to$|number$)/i;
