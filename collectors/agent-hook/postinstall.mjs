// Runs after `npm install -g embertime` (and upgrades). If Ember was already set
// up on this machine, refresh the hook copy in ~/.ember/agent-hook so agents run
// the new version straight away. Your key in ~/.ember/config.json is untouched.
// Best effort: it never fails the install and does nothing on a fresh machine.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dest = path.join(process.env.EMBER_HOME || path.join(os.homedir(), '.ember'), 'agent-hook');
  if (fs.existsSync(path.join(dest, 'ember-hook.mjs'))) {
    for (const f of ['ember-hook.mjs', 'install.mjs', 'package.json']) fs.copyFileSync(path.join(here, f), path.join(dest, f));
    console.log('embertime: updated the hook in ~/.ember/agent-hook (your key is unchanged).');
  }
} catch {
  /* never block an install */
}
