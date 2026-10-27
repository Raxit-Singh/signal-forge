// Marks when this test run started, so the teardown can remove exactly the throwaway
// accounts created during the run — including ones left by a test that failed midway.
export default function globalSetup() {
  process.env.E2E_RUN_STARTED_AT = new Date(Date.now() - 60_000).toISOString();
}
