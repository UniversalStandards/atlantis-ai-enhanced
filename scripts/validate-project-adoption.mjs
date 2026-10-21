import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const failures = [];
const required = ['AGENTS.md', '.github/copilot-instructions.md', '.universal-standards.json'];

for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) failures.push(`missing required file: ${relative}`);
}

const adoptionPath = path.join(root, '.universal-standards.json');
if (fs.existsSync(adoptionPath)) {
  let adoption;
  try {
    adoption = JSON.parse(fs.readFileSync(adoptionPath, 'utf8'));
  } catch (error) {
    failures.push(`invalid .universal-standards.json: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (adoption) {
    if (adoption.upstream_repository !== 'UniversalStandards/UniversalStandards') failures.push('upstream_repository must be UniversalStandards/UniversalStandards');
    if (!/^([0-9a-f]{40})$/i.test(adoption.adopted_commit ?? '')) failures.push('adopted_commit must be a verified 40-character Git commit SHA');
    if (!Array.isArray(adoption.required_controls) || !adoption.required_controls.includes('capability-escalation') || !adoption.required_controls.includes('continuous-learning')) failures.push('required_controls must include capability-escalation and continuous-learning');
    if (!Array.isArray(adoption.intentional_deviations)) failures.push('intentional_deviations must be an array');
  }
}

for (const relative of ['AGENTS.md', '.github/copilot-instructions.md']) {
  const full = path.join(root, relative);
  if (fs.existsSync(full)) {
    const text = fs.readFileSync(full, 'utf8');
    if (!text.includes('UniversalStandards/UniversalStandards')) failures.push(`${relative} must reference the upstream standards repository`);
  }
}

if (failures.length > 0) {
  console.error('Universal Standards adoption validation failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Universal Standards adoption validation passed.');