const KEY_VALUE_REGEX = /\b(API_KEY|TOKEN|SECRET|PASSWORD|ACCESS_KEY)\s*=\s*[^\s]+/gi;
const AWS_KEY_REGEX = /AKIA[0-9A-Z]{16}/g;
const PRIVATE_KEY_REGEX = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const JWT_REGEX = /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;

export function redactText(input: string): { text: string; masked_count: number; masked_chars: number } {
  let text = input;
  let masked_count = 0;
  let masked_chars = 0;

  const apply = (regex: RegExp) => {
    text = text.replace(regex, (match) => {
      masked_count += 1;
      masked_chars += match.length;
      if (match.includes("=")) {
        const [key] = match.split("=");
        return `${key}=***REDACTED***`;
      }
      return "***REDACTED***";
    });
  };

  apply(KEY_VALUE_REGEX);
  apply(AWS_KEY_REGEX);
  apply(PRIVATE_KEY_REGEX);
  apply(JWT_REGEX);

  return { text, masked_count, masked_chars };
}
