# AGENTS.md

## Local development policy

- All active development and validation must use the isolated local checkout, not the production-connected workspace.
- Local app work runs on port 5174 with `--strictPort`; never silently switch ports or fall back to another port.
- Local test data and app configuration must target PocketBase at `http://127.0.0.1:8090`.
- Verify the resolved database destination before testing. Never fall back to production or reuse production credentials for local tests.
- Source syncs must exclude `.git`, `.env*`, `.svelte-kit`, `node_modules`, and `.vite`.
- Routine UI changes require one relevant project check. Before a PR or push, review the diff and run the appropriate tests, type checking, and a production build against the test configuration.
- Pull requests and merges do not require connecting to production PocketBase. Any required schema migration must be documented separately and reviewed before application.
- Production access—including port 5173, production credentials, and database migrations—is reserved for explicitly authorized release or troubleshooting work. Back up before migrations, apply only reviewed changes, and never replace production data with the test database.

## Local app command

```sh
cd /tmp/rentaldesk-test
node --env-file=.env.test --env-file=.env.test.local ./node_modules/vite/bin/vite.js dev --host 0.0.0.0 --port 5174 --strictPort
```

This must be used for local UI work and must stay pointed at the local PocketBase instance.
