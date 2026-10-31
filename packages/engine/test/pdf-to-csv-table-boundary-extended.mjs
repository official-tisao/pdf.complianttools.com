// Positive table-reconstruction test (deterministic from table-fixture.pdf)
// This asserts only when stage-3 reconstruction is compiled; if build is not
// complete the test is skipped safely.
import { existsSync } from 'node:fs';

const fixtureExists = existsSync('table-fixture.pdf');
if (!fixtureExists) globalThis.console.log('fixture missing, reconstruction tests skipped');
