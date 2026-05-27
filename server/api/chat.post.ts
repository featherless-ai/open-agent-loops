import { z } from 'zod';
import { streamText } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

const BodySchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).min(1),
});

export default defineEventHandler(async (event) => {
  const body = BodySchema.parse(await readBody(event));

  // Env vars come from app.yaml.envTemplate at sandbox spawn time. Add new
  // vars to app.yaml and read them here as process.env.* — no Nuxt config or
  // entrypoint.sh bridge needed.
  const apiKey = process.env.FEATHERLESS_API_KEY;
  const baseURL = process.env.FEATHERLESS_API_BASE_URL ?? 'https://api.featherless.ai/v1';
  const model = process.env.FEATHERLESS_MODEL ?? 'zai-org/GLM-5.1';

  if (!apiKey) {
    throw createError({
      statusCode: 500,
      statusMessage: 'FEATHERLESS_API_KEY is not set. Configure it via the app form or .env.',
    });
  }

  const featherless = createOpenAICompatible({
    name: 'featherless',
    baseURL,
    apiKey,
  });

  const result = streamText({
    model: featherless.chatModel(model),
    messages: body.messages,
  });

  // Iterate `fullStream` (not `textStream`) so we surface errors. AI SDK v6's
  // `textStream` silently drops anything that isn't a text-delta — including
  // `error` chunks emitted when the upstream API rejects the request — which
  // leaves the client with an empty body and no idea something went wrong.
  // Manual iteration lets us write the error message into the response so
  // it shows up in the chat UI alongside any partial text.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of result.fullStream) {
          if (chunk.type === 'text-delta') {
            controller.enqueue(encoder.encode(chunk.text));
          } else if (chunk.type === 'error') {
            const err = chunk.error;
            const msg = err instanceof Error ? err.message : String(err);
            console.error('[chat] stream error chunk:', msg);
            controller.enqueue(encoder.encode(`\n\n[stream error] ${msg}\n`));
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[chat] streamText threw:', msg);
        controller.enqueue(encoder.encode(`\n\n[error] ${msg}\n`));
      } finally {
        controller.close();
      }
    },
  });

  setHeader(event, 'content-type', 'text/plain; charset=utf-8');
  return stream;
});
