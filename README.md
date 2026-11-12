# ConsentCart

Know what you are agreeing to before you pay.

ConsentCart is a checkout companion for buyers. The price of a purchase is on the button; the commitment is in the seller's terms: the restocking fee, the "final sale" exception, the refund timing nobody states. ConsentCart puts reading those terms in front of paying. It lays the seller's own wording out as one clear label, lets a language model point at the sentences that matter, and only then opens PayPal for the exact amount you reviewed.

## How it uses AI

A local, OpenAI-compatible chat model is asked, with a JSON-schema-constrained request, to *select* the clauses in the seller's terms that matter for the decision. The server then rebuilds the highlighted passages from the original text.

- The model selects; it does not write. No paraphrase or advice from the model reaches the page.
- Things the seller never states are shown as missing, not filled in.
- The full original text is always one click away, and the "Terms Facts" label works with no model configured.

It was built and tested with `qwen2.5:7b` served by Ollama.

## How it uses PayPal

Payments run on the PayPal REST API in **Sandbox**:

- OAuth 2.0 client credentials (`/v1/oauth2/token`), kept on the server only
- Orders v2: create an order (`POST /v2/checkout/orders`) for the reviewed amount, which is stored on the server and not taken from the browser
- Order creation requires two acknowledgments: "I have read the full purchase terms" and "I agree to pay" the exact amount
- The buyer approves on PayPal's hosted approval page
- Capture (`POST /v2/checkout/orders/{id}/capture`) is a separate, explicit **Pay** action. Returning from PayPal, refreshing or checking status (`GET /v2/checkout/orders/{id}`) never pays automatically, and an unapproved or mismatched order cannot be shown as paid

Only the Sandbox endpoint is used.

## Run it

Requires Node.js 20 or newer. There are no npm dependencies.

Read and label terms (no accounts needed):

```sh
node server.mjs
# open http://127.0.0.1:4178
```

Run with a local model and PayPal Sandbox:

```sh
ollama pull qwen2.5:7b

export PAYPAL_SANDBOX_CLIENT_ID="your sandbox client id"
export PAYPAL_SANDBOX_CLIENT_SECRET="your sandbox client secret"
export AI_MODEL="qwen2.5:7b"                                      # optional, this is the default
export CONSENTCART_STATE_FILE="$HOME/.consentcart/reviews.json"   # optional
export PORT=4178                                                  # optional

node start-local-ai.mjs
```

`start-local-ai.mjs` checks that the model is installed in a local Ollama and starts the app with source-selection highlighting. To use another OpenAI-compatible provider, set `AI_BASE_URL`, `AI_MODEL`, `AI_REVIEW_MODE=source` and, if needed, `AI_API_KEY`, then run `node server.mjs`.

Create Sandbox credentials at <https://developer.paypal.com/dashboard/applications/sandbox>. Pay as the buyer with a Sandbox personal account or one of PayPal's Sandbox test cards.

## A two-minute walkthrough

1. Open the app. The example purchase shows a seller's terms as a **Terms Facts** label; click any line to jump to the seller's exact words. Use **Edit purchase** to paste your own terms, or import them from an HTTPS page or a text PDF.
2. Choose **Highlight with AI**. The passages the model selected are marked in the original text.
3. **Continue to payment**, tick both acknowledgments, then **Continue with PayPal**.
4. Open PayPal and approve as the Sandbox buyer.
5. Back in ConsentCart, **Check payment**, then press **Pay**. The page shows the confirmed payment, and you can save the receipt with the terms you reviewed.

## Scanned PDFs

Text-selectable PDFs are read with the bundled pdf.js. Reading *scanned* PDF pages uses Tesseract.js, which is not bundled because of its size. To enable it, place a Tesseract.js browser build (worker, core and the `eng`/`spa` language data) under `web/vendor/tesseract/`.

## Tests

```sh
npm test
```

## License

MIT. See [LICENSE](LICENSE). pdf.js is bundled under its own license in `web/vendor/pdfjs/`.
