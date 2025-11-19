Project: Prompt Engineering Toolkit — Local prompt variator, heuristic evaluator, and Gemini tester
Short: Generates prompt variants, scores them, and (optionally) tests variants against Google Gemini models. Exports prompt-pack JSON for submission.

Supported Gemini models (configured / tested)

This project is set up to work with two Gemini model IDs by default. Use exactly these IDs in the UI model selector:

gemini-2.5-flash-lite (recommended — lower latency / lighter).

gemini-2.5-flash (higher capability / occasionally higher load).

These are the two models the app UI and server default to; if your API key can access others you may select them from the dropdown populated by the server. If you get a 404 error, call the server's GET /api/list-models to see valid model IDs for your key.

Quick start (local — free)

Install Node.js 18+.

Clone project & install:

git clone <your-repo>
cd prompt-toolkit-local-gemini
npm install


Create a .env file in the project root with your Gemini API key:

GEMINI_API_KEY=AIzaYourKeyHere


(no quotes, no extra spaces)

Start the server:

node server.js


Open http://localhost:3000 in your browser.

Enter a base prompt → Generate Variations → pick a variant → Test with Gemini (ensure the model dropdown is set to one of the two supported models above).

Export via Export JSON to produce /exports/<project>_<ts>.json for submission.

Endpoints (useful)

POST /api/generate-variations — returns 5 prompt variants + heuristic scores.

POST /api/gemini — sends a prompt to Gemini; body: { prompt: "...", model: "gemini-2.5-flash-lite" }.

GET /api/list-models — lists models available to your API key (useful when you get a 404 for a model).

POST /api/export — write prompt-pack JSON to /exports/.