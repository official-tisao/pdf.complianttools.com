/**
 * Cross-platform wrapper for the web build.
 *
 * `vite build` needs PDF_TOOLS_BUILD=1 so svelte.config.js registers the
 * service worker for real builds only. A shell-style `VAR=1 cmd` prefix works on
 * Linux CI but not on Windows cmd, so the variable is set here and the real
 * build is spawned as a child process that inherits the environment.
 */
import { spawn } from 'node:child_process';

const child = spawn('vite', ['build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PDF_TOOLS_BUILD: '1' },
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
