# Node/npm version verification

Environment: Node.js 24.19.0 on Linux. Standard npm dependencies only; SQLite uses node:sqlite.

Passed:
- Clean ZIP extraction into a folder with spaces, npm install (including version-check script), npm test, and npm start serving the sign-in page.
- npm test: complaint/evidence/custody/report workflow; permissions, CSRF, HTML escaping, rejected empty/oversized uploads; password changes; SQLite restart persistence; compatibility with original Python-generated scrypt password hashes.
- Real Chromium browser against npm start: sign-in, register/correct complaint, update status, upload/download bytes, transfer custody, verify current holder/location, history, print PDF, create officer, officer sign-in, change password, search by reference, export CSV and read-only permissions.
- Mobile viewport (390 pixels): no document-level horizontal overflow.
- No browser JavaScript errors or server 5xx responses during the workflow.

Records persist in data/police.db. Sessions end on restart by design. Windows was not available for native testing; this version uses npm commands and has no BAT/Python launcher.
