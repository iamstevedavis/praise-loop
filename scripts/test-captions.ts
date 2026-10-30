import assert from "node:assert/strict";
import { fitCaption, generateCaptionVariants } from "../lib/services/captions";

// Fixture coverage for raw OpenAI Responses API caption decoding (issue #41):
// documented output shapes, multiple output items, empty/malformed content,
// non-2xx responses, and timeouts. No real API key or network required.

const CAPTIONS = {
  friendly: "Cafe Nova made our day ☕",
  premium: "An elevated evening, made memorable at Cafe Nova.",
  playful: "Coffee joy unlocked at Cafe Nova!"
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response;
}

function documentedResponse(text: string): Response {
  return jsonResponse({
    id: "resp_fixture",
    object: "response",
    model: "gpt-4o-mini",
    output: [
      {
        id: "msg_fixture",
        type: "message",
        status: "completed",
        role: "assistant",
        content: [{ type: "output_text", text, annotations: [] }]
      }
    ],
    usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 }
  });
}

const originalFetch = globalThis.fetch;
const originalKey = process.env.OPENAI_API_KEY;
const originalTimeout = process.env.OPENAI_TIMEOUT_MS;
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
const originalOpenRouterModel = process.env.OPENROUTER_MODEL;

type FetchInit = { signal?: AbortSignal; headers?: Record<string, string>; body?: unknown };

function stubFetch(impl: (url: unknown, init: FetchInit) => Promise<Response>) {
  globalThis.fetch = (async (_url: any, init: FetchInit) => impl(_url, init)) as typeof fetch;
}

function restore() {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
  if (originalTimeout === undefined) delete process.env.OPENAI_TIMEOUT_MS;
  else process.env.OPENAI_TIMEOUT_MS = originalTimeout;
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  if (originalOpenRouterModel === undefined) delete process.env.OPENROUTER_MODEL;
  else process.env.OPENROUTER_MODEL = originalOpenRouterModel;
}

async function documentedShapeTest() {
  stubFetch(async () => documentedResponse(JSON.stringify(CAPTIONS)));

  const variants = await generateCaptionVariants({
    businessName: "Cafe Nova",
    quoteText: "Amazing coffee and staff"
  });

  assert.deepEqual(variants, CAPTIONS);
}

async function multipleOutputItemsTest() {
  // Non-message output items (e.g. function_call) are documented parts of the
  // output array and must be skipped without failing the decode.
  stubFetch(async () =>
    jsonResponse({
      output: [
        { id: "fc_1", type: "function_call", name: "draft", arguments: "{}" },
        {
          id: "msg_1",
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(CAPTIONS) }]
        }
      ]
    })
  );

  const variants = await generateCaptionVariants({
    businessName: "Cafe Nova",
    quoteText: "Amazing coffee and staff"
  });

  assert.deepEqual(variants, CAPTIONS);
}

async function fencedJsonTest() {
  stubFetch(async () => documentedResponse("```json\n" + JSON.stringify(CAPTIONS) + "\n```"));

  const variants = await generateCaptionVariants({
    businessName: "Cafe Nova",
    quoteText: "Amazing coffee and staff"
  });

  assert.deepEqual(variants, CAPTIONS);
}

async function emptyOutputArrayTest() {
  stubFetch(async () => jsonResponse({ output: [] }));

  await assert.rejects(
    () => generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "Amazing coffee" }),
    /no text content/
  );
}

async function emptyContentArrayTest() {
  stubFetch(async () =>
    jsonResponse({
      output: [{ id: "msg_1", type: "message", content: [] }]
    })
  );

  await assert.rejects(
    () => generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "Amazing coffee" }),
    /no text content/
  );
}

async function missingOutputArrayTest() {
  stubFetch(async () => jsonResponse({ id: "resp_fixture" }));

  await assert.rejects(
    () => generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "Amazing coffee" }),
    /missing the output array/
  );
}

async function providerErrorIsRedactedTest() {
  const secretPrompt = "CUSTOMER_REVIEW_RAW_TEXT_THAT_MUST_NEVER_BE_LOGGED";
  stubFetch(async () =>
    jsonResponse(
      { error: { message: `request failed: ${secretPrompt}`, code: "rate_limit_exceeded" } },
      429
    )
  );

  await assert.rejects(
    () => generateCaptionVariants({ businessName: "Cafe Nova", quoteText: secretPrompt }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /HTTP 429 \(rate_limit_exceeded\)/);
      assert.doesNotMatch(err.message, /CUSTOMER_REVIEW_RAW_TEXT/);
      return true;
    }
  );
}

async function timeoutTest() {
  process.env.OPENAI_TIMEOUT_MS = "50";
  // Mirror undici: reject with AbortError once the timeout signal fires.
  stubFetch((_url, init) => {
    const signal = init.signal ?? new AbortController().signal;
    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("The operation was aborted.", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      });
    });
  });

  // AbortSignal.timeout uses an unref'd timer; keep the loop alive so it can fire.
  const keepAlive = new Promise<void>((resolve) => setTimeout(resolve, 500));
  await assert.rejects(
    () => generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "Amazing coffee" }),
    /timed out after 50ms/
  );
  await keepAlive;
}

async function missingApiKeyTest() {
  delete process.env.OPENAI_API_KEY;
  stubFetch(async () => documentedResponse(JSON.stringify(CAPTIONS)));

  try {
    await assert.rejects(
      () => generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "Amazing coffee" }),
      /OPENAI_API_KEY is not set/
    );
  } finally {
    process.env.OPENAI_API_KEY = "sk-test-fixture";
  }
}

async function authorizationHeaderTest() {
  stubFetch(async (_url, init) => {
    const headers = init.headers as Record<string, string>;
    assert.equal(headers.authorization, `Bearer ${process.env.OPENAI_API_KEY}`);
    return documentedResponse(JSON.stringify(CAPTIONS));
  });

  await generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "Amazing coffee" });
}

function chatResponse(content: unknown): Response {
  return jsonResponse({ id: "gen-fixture", model: "vendor/model:free", choices: [{ index: 0, message: { role: "assistant", content } }] });
}

async function openRouterTest() {
  delete process.env.OPENAI_API_KEY;
  process.env.OPENROUTER_API_KEY = "sk-or-test-fixture";
  process.env.OPENROUTER_MODEL = "vendor/some-model:free";
  const params = { businessName: "Cafe Nova", quoteText: "Amazing coffee" };
  try {
    // The model comes only from the setting; the request is a chat completion with bearer auth.
    let seen: { url: string; auth: string | undefined; model: string; prompt: string } | null = null;
    stubFetch(async (url, init) => {
      const body = JSON.parse(String(init.body)) as { model: string; messages: { content: string }[]; reasoning?: { enabled?: boolean } };
      assert.deepEqual(body.reasoning, { enabled: false }, "reasoning is disabled so thinking models cannot exhaust the token budget");
      seen = { url: String(url), auth: init.headers?.authorization, model: body.model, prompt: body.messages[0].content };
      return chatResponse(JSON.stringify(CAPTIONS));
    });
    assert.deepEqual(await generateCaptionVariants(params), CAPTIONS);
    assert.deepEqual(
      { ...seen!, prompt: undefined },
      { url: "https://openrouter.ai/api/v1/chat/completions", auth: "Bearer sk-or-test-fixture", model: "vendor/some-model:free", prompt: undefined }
    );
    assert.match(seen!.prompt, /Cafe Nova/);

    // Fenced JSON and array-of-parts content decode like the OpenAI path.
    stubFetch(async () => chatResponse("```json\n" + JSON.stringify(CAPTIONS) + "\n```"));
    assert.deepEqual(await generateCaptionVariants(params), CAPTIONS);
    stubFetch(async () => chatResponse([{ type: "text", text: JSON.stringify(CAPTIONS) }]));
    assert.deepEqual(await generateCaptionVariants(params), CAPTIONS);

    // Malformed responses fail with a clear error.
    stubFetch(async () => jsonResponse({ choices: [] }));
    await assert.rejects(() => generateCaptionVariants(params), /missing the choices array/);
    stubFetch(async () => chatResponse(null));
    await assert.rejects(() => generateCaptionVariants(params), /no text content/);

    // Errors never echo the body, and OpenRouter's numeric error code is reported.
    const secret = "CUSTOMER_REVIEW_RAW_TEXT_THAT_MUST_NEVER_BE_LOGGED";
    stubFetch(async () => jsonResponse({ error: { message: `bad: ${secret}`, code: 429 } }, 429));
    await assert.rejects(() => generateCaptionVariants({ ...params, quoteText: secret }), (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /HTTP 429 \(429\).*openrouter\.ai\/status/);
      assert.doesNotMatch(err.message, /CUSTOMER_REVIEW_RAW_TEXT/);
      return true;
    });

    // The model is a required setting: no default is guessed, and nothing is sent without it.
    stubFetch(async () => { throw new Error("must not call the network without a model"); });
    for (const missing of [undefined, "   "]) {
      if (missing === undefined) delete process.env.OPENROUTER_MODEL; else process.env.OPENROUTER_MODEL = missing;
      await assert.rejects(() => generateCaptionVariants(params), /OPENROUTER_MODEL is not set/);
    }

    // OpenAI keeps priority when both are configured, so existing deployments are unchanged.
    process.env.OPENROUTER_MODEL = "vendor/some-model:free";
    process.env.OPENAI_API_KEY = "sk-test-fixture";
    let url = "";
    stubFetch(async (u) => { url = String(u); return documentedResponse(JSON.stringify(CAPTIONS)); });
    await generateCaptionVariants(params);
    assert.equal(url, "https://api.openai.com/v1/responses");
  } finally {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_MODEL;
    process.env.OPENAI_API_KEY = "sk-test-fixture";
  }
}

const SENTENCE = "Cafe Nova made our whole week with that warm welcome. ";
const longCaption = (chars: number) => SENTENCE.repeat(Math.ceil(chars / SENTENCE.length)).slice(0, chars - 1).trim() + ".";

function endsCleanly(text: string) {
  assert.ok(text.length <= 200, `too long: ${text.length}`);
  assert.doesNotMatch(text, /\.\.\.|…/, "no truncation ellipsis");
  assert.match(text, /[.!?]$|#\w+$|\w$/, "ends on a whole word or sentence");
}

async function fitCaptionTest() {
  assert.equal(fitCaption("Short and sweet."), "Short and sweet.");
  const sentences = fitCaption(longCaption(260));
  endsCleanly(sentences);
  assert.match(sentences, /\.$/, "prefers ending on a full sentence");

  // No sentence boundary after the minimum: cut on a whole word, never mid-word or mid-hashtag.
  const words = fitCaption(("loving " + "#CafeNovaRegular ".repeat(30)).trim());
  endsCleanly(words);
  for (const word of words.split(" ")) assert.ok(word === "loving" || word === "#CafeNovaRegular", `partial word kept: ${word}`);

  // One unbroken run has no boundary to use.
  assert.equal(fitCaption("x".repeat(250)).length, 200);
}

async function overlongCaptionRetryTest() {
  const ok = "Cafe Nova made our day. Thank you for the kind words!";
  const prompts: string[] = [];
  const respond = (second: () => Response) => {
    let call = 0;
    stubFetch(async (_url, init) => {
      prompts.push(String((JSON.parse(String(init.body)) as { input: string }).input));
      call += 1;
      return call === 1
        ? documentedResponse(JSON.stringify({ friendly: longCaption(230), premium: ok, playful: ok }))
        : second();
    });
    return () => call;
  };

  // A caption within the limit needs one call and is untouched.
  let calls = 0;
  stubFetch(async () => { calls += 1; return documentedResponse(JSON.stringify(CAPTIONS)); });
  assert.deepEqual(await generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "x" }), CAPTIONS);
  assert.equal(calls, 1);

  // Over the limit: one retry for just that style, and its shorter rewrite is used verbatim.
  const shorter = "Cafe Nova made our week. Thanks for the kind words #CafeNova";
  let count = respond(() => documentedResponse(JSON.stringify({ friendly: shorter })));
  const fixed = await generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "x" });
  assert.equal(count(), 2);
  assert.equal(fixed.friendly, shorter);
  assert.equal(fixed.premium, ok);
  assert.match(prompts[1], /too long/);
  assert.doesNotMatch(prompts[1], /Thank you for the kind words!/, "only the captions that are too long are resent");

  // The retry is also over the limit: cut on a sentence boundary, no ellipsis, no further calls.
  count = respond(() => documentedResponse(JSON.stringify({ friendly: longCaption(240) })));
  const stillLong = await generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "x" });
  assert.equal(count(), 2);
  endsCleanly(stillLong.friendly);

  // The retry request fails or returns nothing usable: still a good caption, not a failed draft.
  count = respond(() => { throw new Error("network down"); });
  endsCleanly((await generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "x" })).friendly);
  assert.equal(count(), 2);
  count = respond(() => documentedResponse("not json at all"));
  endsCleanly((await generateCaptionVariants({ businessName: "Cafe Nova", quoteText: "x" })).friendly);

  // The prompt asks for less than the hard limit.
  assert.match(prompts[0], /<= 180 characters \(hard limit 200\)/);
}

async function main() {
  process.env.OPENAI_API_KEY = "sk-test-fixture";

  try {
    await documentedShapeTest();
    await multipleOutputItemsTest();
    await fencedJsonTest();
    await emptyOutputArrayTest();
    await emptyContentArrayTest();
    await missingOutputArrayTest();
    await providerErrorIsRedactedTest();
    await timeoutTest();
    await missingApiKeyTest();
    await authorizationHeaderTest();
    await openRouterTest();
    await fitCaptionTest();
    await overlongCaptionRetryTest();
  } finally {
    restore();
  }

  console.log("caption decoding tests passed");
}

main().catch((err) => {
  restore();
  console.error(err instanceof Error ? err.stack : String(err));
  process.exitCode = 1;
});
