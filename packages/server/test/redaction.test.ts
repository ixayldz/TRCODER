import { describe, expect, it } from "vitest";
import { redactText } from "../src/redaction";


describe("redaction", () => {
  it("masks common secrets", () => {
    const input = "API_KEY=supersecret\npassword=foo\nAKIA1234567890ABCD12";
    const result = redactText(input);
    expect(result.text).toContain("API_KEY=***REDACTED***");
    expect(result.text.toLowerCase()).toContain("password=***redacted***");
    expect(result.text).toContain("***REDACTED***");
    expect(result.masked_count).toBeGreaterThan(0);
  });
});
