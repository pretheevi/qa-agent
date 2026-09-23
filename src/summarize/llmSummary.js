import { config } from '../config/config.js';

// Calls a local Ollama model to turn failures into a plain-language summary.
export async function summarizeFailures(failures) {
  if (!failures.length) return '';

  const prompt = `Explain these failed QA testcases in simple, plain terms so the reader can ` +
    `quickly understand what went wrong with each one — the audience is technical (QA/dev ` +
    `team), so keep the testcase names/IDs, just skip unnecessary verbosity. Keep it brief ` +
    `(3-5 sentences), but cover every failed testcase and the actual reason it failed:\n` +
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