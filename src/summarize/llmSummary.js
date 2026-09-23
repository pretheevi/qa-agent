import { config } from '../config/config.js';

// Calls a local Ollama model to turn failures into a plain-language summary.
export async function summarizeFailures(failures) {
  if (!failures.length) return '';

  const prompt = `Write a brief but detailed summary of these failed QA testcases for a ` +
    `non-technical audience. Use simple, everyday English — no jargon, no test IDs, no ` +
    `code terms. Keep it short (3-5 sentences), but make sure every failed testcase is ` +
    `mentioned and what actually went wrong with it is clear:\n` +
    failures.map(f => {
      // NOVA
      if (f.testcaseName) {
        return `- ${f.testcaseName}: ${f.reason || 'Failure reason not provided'}`;
      }

      // ATLAS
      if (f.testCaseName) {
        const failureDetails = f.failures?.length
          ? f.failures.map(failure => failure.details).join('; ')
          : 'Failure details not provided';

        return `- ${f.testCaseName}: ${failureDetails}`;
      }

      return '- Unknown testcase: Failure details not provided';
    }).join('\n');

  try {
    const res = await fetch(`${config.ollama.host}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.ollama.model,
        prompt,
        stream: false,
      }),
    });

    const data = await res.json();

    return data.response?.trim() || '';
  } catch (err) {
    console.error('[LLM] summary failed, continuing without it:', err.message);
    return '';
  }
}