// Shared AI chat-completions client.
//
// The Lovable-hosted app called the Lovable AI Gateway (an OpenAI-compatible
// proxy in front of Google Gemini). Outside Lovable we call Gemini directly via
// its OpenAI-compatible endpoint, which accepts the same request body (messages,
// tools, max_tokens, ...), so the calling code only changes the URL, key and model.
//
// Secrets (set with `supabase secrets set ...`):
//   GEMINI_API_KEY  required — https://aistudio.google.com/apikey
//   AI_BASE_URL     optional — any OpenAI-compatible base URL, defaults to Gemini
//   AI_MODEL_FLASH  optional — overrides the default model name
//
// Model note: the gateway-era ids (google/gemini-2.5-flash, google/gemini-3-flash-preview)
// are no longer served to new Gemini API keys ("no longer available to new users",
// Google recommends gemini-3.6-flash), so both map to DEFAULT_MODEL below.

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
const DEFAULT_MODEL = 'gemini-3.6-flash'
const LEGACY_MODELS = new Set(['google/gemini-2.5-flash', 'google/gemini-3-flash-preview'])

export function aiConfigured(): boolean {
  return Boolean(Deno.env.get('GEMINI_API_KEY'))
}

// Maps the gateway-style model ids used in this codebase to Gemini API ids.
export function resolveModel(model: string): string {
  const override = Deno.env.get('AI_MODEL_FLASH')
  if (override) return override
  if (LEGACY_MODELS.has(model)) return DEFAULT_MODEL
  return model.replace(/^google\//, '')
}

export async function chatCompletion(body: Record<string, unknown>): Promise<Response> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY not configured')
  }
  const baseUrl = (Deno.env.get('AI_BASE_URL') || DEFAULT_BASE_URL).replace(/\/$/, '')
  const model = resolveModel(String(body.model ?? 'google/gemini-2.5-flash'))
  return await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...body, model }),
  })
}
