#!/usr/bin/env node
/**
 * Kill any orphaned Vite dev-server processes still listening on port 4174 (local tests)
 * or 4173 (CI). Call before starting Playwright so stale servers don't interfere.
 */
import { execSync } from 'node:child_process';

const PORTS = ['4174', '4173'];

for (const port of PORTS) {
  try {
    // Find PIDs using the port (lsof-style; falls back to fuser).
    const output = execSync(`lsof -t -i:${port} 2>/dev/null || fuser ${port}/tcp 2>/dev/null`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    for (const pid of output.split(/\s+/).filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGTERM');
        console.log(`Killed orphaned process ${pid} on port ${port}`);
      } catch (e) {
        // Process may have exited between detection and kill.
        console.log(`No process ${pid} to kill on port ${port} (${e.message})`);
      }
    }
  } catch {
    // No orphaned process found on this port — expected on a clean machine.
  }
}
