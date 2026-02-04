# TRCODER - Providers (V1)

## Model Providers
- V1 supports OpenAI, Anthropic, and Google (Gemini AI Studio).
- Provider fallback chains are defined in `config/model-stack.v2.json`.
- If no real provider is available, TRCODER falls back to a mock provider for dev/test.
- Set `TRCODER_USE_MOCK_PROVIDER=true` to force mock provider even when API keys exist.

## Environment Variables
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY` (or `GEMINI_API_KEY`)

Optional:
- `OPENAI_BASE_URL`, `OPENAI_RPM`
- `ANTHROPIC_BASE_URL`, `ANTHROPIC_RPM`
- `GOOGLE_BASE_URL`, `GOOGLE_RPM`
- `TRCODER_USE_MOCK_PROVIDER` (true/false)
