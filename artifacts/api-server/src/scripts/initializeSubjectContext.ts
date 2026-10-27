/** One-off operator entry for the reviewed horizon subject context. No inference or credential output. */
import { pool } from '@workspace/db';
import { checkSubjectContextNetwork, initializeSubjectContextNetwork } from '../formal/subjects';

const binding = {
  submissionId: '1a74fdf4-4e69-4e94-945e-811f742b6c86',
  expectedRevisionId: '1dee5f62-1ea5-4d1a-a3c2-0caa08501184',
  expectedPackageDigest: '218eb4ef06287c6920a1962a4c70f6133c27e188477b32dc47c18f3d62b0d2ef',
  expectedSourceSha256: '0dab6492b6814c887b8d40b675b33693145c80be91a11300c1188ade83193dc9',
  parentSlug: 'gravitational-energetics-and-thermodynamics',
  childSlug: 'horizon-thermodynamics',
};
async function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(arg => !['--check', '--apply'].includes(arg))) {
    console.error('Usage: node initializeSubjectContext.mjs [--check | --apply]');
    process.exitCode = 2;
    return;
  }
  const before = await checkSubjectContextNetwork(binding);
  const result = args[0] === '--apply' ? await initializeSubjectContextNetwork(binding) : null;
  const after = result ? await checkSubjectContextNetwork(binding) : before;
  console.log(JSON.stringify({ mode: result ? 'applied' : 'check', before, result, after }, null, 2));
}
main().catch(error => {
  // Database/library errors can contain connection details; emit classification only.
  console.error(JSON.stringify({ error: 'Subject context maintenance did not complete.', type: error?.name || 'Error', status: Number.isInteger(error?.status) ? error.status : null }));
  process.exitCode = 1;
}).finally(() => pool.end());
