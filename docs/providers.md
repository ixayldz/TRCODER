# TRCODER — Providers (V1)

## Model Providers
- V1 ships with a mock provider for end-to-end testing.
- Real provider integrations are behind `IModelClient` interfaces.
- Provider fallback chains are defined in `config/model-stack.v2.json`.

## Future Integrations
- OpenAI, Anthropic, Google, DeepSeek are planned.
- Retry/backoff and circuit breakers are planned for V2.
