// server.js
// Prompt Engineering Toolkit with optional Gemini testing
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ----------------- Prompt variation utilities -----------------
function addSystemRole(prompt, role) {
  return `System: ${role}\nUser: ${prompt}`;
}

function addFewShot(prompt, examples) {
  if (!examples || examples.length === 0) return prompt;
  const fewShot = examples.map((ex, i) => `Example ${i+1}:\nInput: ${ex.input}\nOutput: ${ex.output}`).join('\n\n');
  return `${fewShot}\n\nNow, given the user input, respond concisely.\nUser: ${prompt}`;
}

function tightenInstructions(prompt, constraints) {
  let c = constraints && constraints.length ? constraints.join('; ') + '; ' : '';
  return `Instruction: ${c}Be concise and precise.\nUser: ${prompt}`;
}

function paraphrasePrompt(prompt) {
  let p = prompt;
  p = p.replace(/\bplease\b/ig, '').trim();
  p = p.replace(/\bCreate\b/ig, 'Generate');
  p = p.replace(/\bDescribe\b/ig, 'Summarize');
  if (p.length > 120) p = p.slice(0, 110) + '...';
  return p;
}

function injectKeywords(prompt, keywords) {
  if (!keywords || keywords.length === 0) return prompt;
  const kwLine = `Keywords to include: ${keywords.join(', ')}.`;
  return `${prompt}\n\n${kwLine}`;
}

// ----------------- Heuristic evaluation -----------------
function evaluatePrompt(prompt, keywords = [], testCases = []) {
  const length = prompt.length;
  const clarity = Math.max(10, Math.min(100, Math.round(100 - Math.abs(120 - length) * 0.5)));
  const specificityWords = ['exact', 'concise', 'step-by-step', 'numbered', 'limit', 'only', 'format', 'json'];
  const specificityCount = specificityWords.reduce((acc, w) => acc + (new RegExp('\\b' + w + '\\b','i').test(prompt) ? 1 : 0), 0);
  const specificity = Math.min(100, specificityCount * 25 + 20);
  const foundKeywords = keywords.filter(k => new RegExp('\\b' + escapeRegExp(k) + '\\b','i').test(prompt));
  const keywordCoverage = keywords.length ? Math.round((foundKeywords.length / keywords.length) * 100) : 0;
  let testScore = 0;
  if (testCases && testCases.length) {
    const pass = testCases.reduce((acc, t) => {
      const required = t.mustInclude || [];
      const ok = required.every(r => new RegExp('\\b' + escapeRegExp(r) + '\\b','i').test(prompt));
      return acc + (ok ? 1 : 0);
    }, 0);
    testScore = Math.round((pass / testCases.length) * 100);
  }
  const overall = Math.round((clarity + specificity + keywordCoverage + testScore)/4);
  return { clarity, specificity, keywordCoverage, testScore, overall, foundKeywords };
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ----------------- API endpoints -----------------
app.post('/api/generate-variations', (req, res) => {
  const { basePrompt, keywords = [], examples = [], constraints = [] } = req.body;
  if (!basePrompt) return res.status(400).json({ error: 'basePrompt required' });

  const variations = [];

  variations.push({
    id: uuidv4(),
    type: 'system-role:expert',
    prompt: addSystemRole(basePrompt, 'You are an expert assistant with deep domain knowledge.')
  });

  variations.push({
    id: uuidv4(),
    type: 'few-shot',
    prompt: addFewShot(basePrompt, examples)
  });

  variations.push({
    id: uuidv4(),
    type: 'tight-constraints',
    prompt: tightenInstructions(basePrompt, constraints)
  });

  variations.push({
    id: uuidv4(),
    type: 'paraphrase',
    prompt: paraphrasePrompt(basePrompt)
  });

  variations.push({
    id: uuidv4(),
    type: 'keyword-injection',
    prompt: injectKeywords(basePrompt, keywords)
  });

  const scored = variations.map(v => {
    const evalRes = evaluatePrompt(v.prompt, keywords, []);
    return { ...v, evaluation: evalRes };
  });

  res.json({ basePrompt, variations: scored });
});

app.post('/api/evaluate', (req, res) => {
  const { prompt, keywords = [], testCases = [] } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  const evalRes = evaluatePrompt(prompt, keywords, testCases);
  res.json({ prompt, evaluation: evalRes });
});

// ----------------- List Models endpoint -----------------
app.get('/api/list-models', async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY environment variable not set' });

  const url = 'https://generativelanguage.googleapis.com/v1beta/models';
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'x-goog-api-key': apiKey }
    });
    const text = await resp.text();
    if (!resp.ok) return res.status(resp.status).json({ ok: false, status: resp.status, body: text });
    const json = JSON.parse(text);
    // return list of models
    res.json({ ok: true, raw: json });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ----------------- Gemini integration endpoint -----------------
// This endpoint forwards the prompt to Gemini REST API using your API key
// Make sure to set GEMINI_API_KEY environment variable before starting the server:
// export GEMINI_API_KEY="your_key_here"
app.post('/api/gemini', async (req, res) => {
  const { prompt, model = 'gemini-2.5-flash-lite' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'prompt required' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(400).json({ error: 'GEMINI_API_KEY environment variable not set' });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Minimal documented payload
  const body = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ]
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) {
      const txt = await resp.text();
      // If model not found, hint to call list-models
      if (resp.status === 404) {
        return res.status(404).json({
          ok: false,
          status: 404,
          body: txt,
          hint: 'Model not found. Call GET /api/list-models to see available models and exact model IDs.'
        });
      }
      // pass other errors back
      return res.status(resp.status).json({ ok: false, status: resp.status, body: txt });
    }

    const json = await resp.json();

    // Try to extract text from common shapes
    let text = '';
    try {
      if (json.candidates && Array.isArray(json.candidates) && json.candidates[0] && json.candidates[0].content) {
        text = json.candidates[0].content.map(c => (c.parts || []).map(p => p.text || '').join('')).join('\n\n');
      } else if (json.output && Array.isArray(json.output) && json.output[0] && json.output[0].content) {
        text = json.output[0].content.map(c => (c.parts || []).map(p => p.text || '').join('')).join('\n\n');
      } else {
        text = JSON.stringify(json, null, 2);
      }
    } catch (e) {
      text = JSON.stringify(json, null, 2);
    }

    res.json({ ok: true, model, extracted: text, raw: json });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Export pack endpoint (creates file in /exports)
app.post('/api/export', (req, res) => {
  const { projectName = 'prompt-pack', basePrompt, variations = [], metadata = {} } = req.body;
  const payload = { metadata, basePrompt, variations, exportedAt: new Date().toISOString() };
  const fname = `${projectName.replace(/\s+/g,'_')}_${Date.now()}.json`;
  const outPath = path.join(__dirname, 'exports');
  if (!fs.existsSync(outPath)) fs.mkdirSync(outPath);
  fs.writeFileSync(path.join(outPath, fname), JSON.stringify(payload, null, 2));
  res.json({ ok: true, file: `/exports/${fname}` });
});

app.use('/exports', express.static(path.join(__dirname, 'exports')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Prompt Toolkit running on http://localhost:${PORT}`);
  console.log('GEMINI key loaded:', process.env.GEMINI_API_KEY ? 'YES' : 'NO');
});
