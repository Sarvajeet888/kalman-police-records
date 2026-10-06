# Kalman Systems — Police Records
Police Complaint and Evidence Tracking System · DBMS group project by Sarvajeet Bajikar and Adhiraj Kalkundrikar.

## Run (Windows, macOS or Linux)
Install **Node.js 24 or newer** from https://nodejs.org/ if needed. Reopen your terminal after installing.

1. Extract the entire ZIP.
2. Open a terminal in the extracted folder containing **package.json**.
3. Run:

```sh
npm install
npm start
```

4. Open **http://localhost:3000**. If 3000 is occupied, the terminal prints the next available port.
5. Sign in with **admin / Kalman@123**.

Keep the terminal open. Press Ctrl+C to stop. Use `npm start` for later runs; installation is needed only once. First installation needs internet. No Python, BAT files, node-gyp, Visual Studio build tools or separate SQL server is required. Node 24's SQLite module may print an experimental warning; it does not stop the application.

Other demo logins: **asha** and **vikram**, initial password **Kalman@123**. Change your password from Account settings. The administrator can add officer accounts on the Officers page.

### If it doesn't start
- Run `node -v`: version must be 24 or newer. Older versions show a direct upgrade message.
- If `npm` isn't recognized, install Node.js and reopen the terminal.
- If `package.json` isn't found, you opened the wrong folder. The ZIP has package.json at its root; open the extracted folder, not a parent folder.
- In Windows PowerShell, if script execution policy blocks npm, use `npm.cmd install` and `npm.cmd start`, or use Command Prompt. No policy change is necessary.
- If the terminal shows a different address because port 3000 was busy, open the printed address.

## Demo walkthrough
1. New complaint → enter complainant and incident details → assign an officer → Register complaint.
2. Evidence tab → Add evidence → choose a file (up to 10 MB) or register a physical item without a file.
3. Transfer custody → choose a receiving officer, storage location and reason.
4. Check the current holder/location in Evidence and the full chain in Custody log.
5. Overview → update the status with a note. History retains the record of each update.
6. Edit details if corrections are needed; Print case report generates a browser-printable report (Save as PDF).
7. Export CSV from Complaints, or search by reference, complainant or title.
8. Restart the server and sign in again: records and evidence remain saved.

## Animated group presentation
Open `presentation/index.html` in your browser. Six animated slides explain tables, primary/foreign keys and basic SQL. Arrow keys navigate, F opens fullscreen and N opens Hinglish speaker notes.

## What is retained from the earlier model
The interface, six-table SQLite schema and case workflows are retained. Express replaces Flask, and Nunjucks renders the existing HTML templates. Python dependencies and launchers are removed.

To reuse your previous database, stop both applications. Back up your old **data/police.db** file. Copy it into this project's **data** folder **before first launch**, without overwriting a database that contains newer records. Original scrypt password hashes are supported. All complaint/evidence rows, files and custody history remain in the same SQLite database; sessions are new, so sign in again. Keep a copy of the original until you verify your records.

## Project structure
- `package.json` / `package-lock.json`: scripts and locked dependencies
- `server.js`: Express routes, authentication, authorization and SQL operations
- `scripts/start.js`: localhost server; port conflict handling
- `scripts/check-node.js`: Node version check
- `schema.sql`: tables, indexes, constraints and custody triggers
- `queries.sql`: JOIN, GROUP BY and latest-custodian examples
- `templates/`: server-rendered HTML views
- `static/`: CSS and small browser interaction script
- `tests/workflow.test.js`: real HTTP workflow and database tests
- `data/police.db`: created automatically, excluded from the ZIP
- `Police_Complaint_DBMS_Presentation.pptx`: six slides, updated for Node/Express

## DBMS concepts
Six tables: officers, complainants, complaints, evidence, custody, status_history. Each uses a primary key; foreign keys link complaints to complainants/officers, evidence to complaints and custody events to evidence/officers. The design separates entity and event attributes (3NF); current complaint status is a deliberate summary updated transactionally with history.

Transactions keep complaint registration plus initial history, and evidence plus initial custody, atomic. SQLite foreign keys are enabled. Parameterized queries handle input. Indexes support status, case evidence and custody lookups. Current holder/location is derived from the newest custody event. UPDATE/DELETE triggers protect normal writes to custody history. Attachments are BLOBs with a SHA-256 hash checked on download.

Admin: can modify/reassign any complaint and add officers. Assigned officers: can update their cases and evidence. All signed-in staff can read the station register, reports and evidence, and register new complaints. Records are corrected or closed rather than permanently deleted.

## Tests
```sh
npm test
```
Covers real HTTP routes, transactions, search, uploads/downloads, custody, reports, status changes, correction, permissions, CSRF, escaping, invalid files, hash mismatch, account creation/password changes, restart persistence and old password compatibility. Browser checks additionally exercised dialogs, mobile layout, downloads and printing. Native Windows execution was not available for testing; no shell-specific launcher is required.

## Data and scope
The server binds to localhost. This is a functioning local PBL model, not an officially integrated police/FIR system. Login sessions are in memory and expire on restart; database records remain. Stop the server before copying `data` for a backup. Default records are fictional. Passwords are scrypt-hashed; HTML is escaped; state-changing forms use CSRF tokens; uploaded files are download-only.

Before real public deployment: persistent session storage, HTTPS, login rate limiting, stronger account lifecycle controls, privacy policy/access reviews, encrypted backups, signed custody handovers and independent security validation are needed. A file hash cannot establish legal admissibility or prevent a database administrator changing both the file and its stored hash. Administrative access can bypass database triggers.
