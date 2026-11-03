#!/usr/bin/env node
/**
 * Kill any orphaned Vite dev-server processes still listening on port 4174 (local tests)
 * or 4173 (CI). Call before starting Playwright so stale servers don't interfere.
 */
import { execSync } from 'node:child_process';
import { platform } from 'node:os';

const PORTS = ['4174', '4173'];

/**
 * Determine the appropriate command to find processes listening on a port
 * Windows: use netstat -ano | findstr :<port>
 * Unix: use lsof -t -i:<port> or fuser <port>/tcp
 */
function getPlatformPortCommand(port) {
  if (platform() === 'win32') {
    return `netstat -ano | findstr :${port}`;
  }
  // Unix-style: prefer lsof, fall back to fuser
  return `lsof -t -i:${port} 2>/dev/null || fuser ${port}/tcp 2>/dev/null`;
}

/**
 * Parse netstat output to find PIDs listening on a port
 * Windows: last column is PID
 */
function findPidsWindows(output) {
  const pids = new Set();
  for (const line of output.trim().split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.includes('findstr')) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    // The last token should be the PID
    const last = parts[parts.length - 1];
    if (/^\d+$/.test(last)) {
      pids.add(Number(last));
    }
  }
  return Array.from(pids);
}

/**
 * Parse lsof/fuser output to find PIDs listening on a port
 * Unix: one PID per line
 */
function findPidsUnix(output) {
  const pids = new Set();
  for (const line of output.trim().split(/\n/)) {
    if (line.trim() && line.match(/^\d+$/)) {
      pids.add(Number(line.trim()));
    }
  }
  return Array.from(pids);
}

/**
 * Get command line for a given PID
 * Windows: use Get-CimInstance with proper filtering
 */
function getProcessCommandLineWindows(pid) {
  try {
    const out = execSync(
      `powershell -Command "Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' | Select-Object -ExpandProperty CommandLine"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 2000 },
    );
    return out.trim();
  } catch {
    return '';
  }
}

/**
 * Check if a process is an orphaned Vite server
 */
function isOrphanedViteProcess(pid, cmdLine) {
  const cmd = cmdLine || getProcessCommandLineWindows(pid);
  const isNode = cmd.includes('node') || cmd.includes('node.exe') || cmd.includes('nodejs');
  const isVite =
    /vite/.test(cmd) ||
    /dev/.test(cmd) ||
    /vite/.test(cmd) ||
    cmd.includes('vite') ||
    cmd.includes('dev');
  return isNode && isVite;
}

for (const port of PORTS) {
  const command = getPlatformPortCommand(port);
  let output = '';
  let error = null;

  try {
    output = execSync(command, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
  } catch (e) {
    error = e;
  }

  if (error || output.trim().length === 0) {
    // No listener found on this port — expected on a clean machine
    console.log(`No listener found on port ${port}`);
    continue;
  }

  const pids = platform() === 'win32' ? findPidsWindows(output) : findPidsUnix(output);
  // Prevent processing invalid PID 0 which causes hang on Windows get-process queries
  const validPids = pids.filter((pid) => pid > 0);

  if (validPids.length === 0) {
    console.log(`No orphaned process found on port ${port}`);
    continue;
  }

  for (const pid of validPids) {
    const cmdLine =
      platform() === 'win32' ? getProcessCommandLineWindows(pid) : getProcessCommandLineUnix(pid);

    if (!isOrphanedViteProcess(pid, cmdLine)) {
      console.log(`Skipping PID ${pid} on port ${port} — unrelated process`);
      continue;
    }

    try {
      process.kill(pid, 'SIGTERM');
      console.log(`Killed orphaned Vite process ${pid} on port ${port}`);
    } catch (e) {
      console.log(`No process ${pid} to kill on port ${port} (${e.message})`);
    }
  }
}

/**
 * Unix command line extraction
 */
function getProcessCommandLineUnix(pid) {
  try {
    const out = execSync(`cat /proc/${pid}/cmdline 2>/dev/null | tr '\0' ' '`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return out.trim();
  } catch {
    return '';
  }
}
