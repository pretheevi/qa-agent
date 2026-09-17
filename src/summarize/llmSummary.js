import { config } from '../config/config.js';

// Optional: calls a local Ollama model to turn failures into a plain-language summary.
export async function summarizeFailures(failures) {
  if (!failures.length) return '';

  const prompt = `Summarize these failed QA testcases in 2-3 simple sentences for a non-technical audience:\n` +
    failures.map(f => `- ${f.testcaseName}: ${f.reason}`).join('\n');

  try {
    const res = await fetch(`${config.ollama.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.ollama.model, prompt, stream: false }),
    });
    const data = await res.json();
    return data.response?.trim() || '';
  } catch (err) {
    console.error('[LLM] summary failed, continuing without it:', err.message);
    return '';
  }
}
