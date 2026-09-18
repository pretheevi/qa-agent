// Acknowledgment convention: audience replies with subject "Acknowledged - <original report subject>".
// The original subject already embeds the report's own date, so this string alone identifies
// which cached report is being acknowledged (see reminder/remainder.js).
export function ackInstructionsHtml(reportSubject) {
  const ackSubject = `Acknowledged - ${reportSubject}`;
  return `<p style="color:#1565c0;"><strong>To acknowledge this report</strong>, reply to this email with the subject line exactly:<br/><code>${ackSubject}</code></p>`;
}
