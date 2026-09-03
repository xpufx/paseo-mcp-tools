# Testing Notes & Environment Log

## Test Setup
- **Host**: Ubuntu 24.04 LTS (kernel 6.8, x86_64)
- **Runtime**: Node.js 22.23
- **Environment**: Local daemon process running on the host system

---

## What We Tested and How

### 1. Adapter Crash Prevention & Contracts
We started by writing an automated test runner that loops over every registered adapter. For each one, we simulated a fresh machine with no config files or target software installed. The goal was to make sure no adapter throws an unhandled exception or kills the host process if its target isn't there. We also checked that every adapter returns the exact object shapes the UI expects, and that any API keys or tokens are stripped out before anything gets displayed.

### 2. Config Discovery & File Precedence
Next, we tested how configs get discovered on disk. We created dummy folder structures with broken JSON, missing paths, and conflicting settings to verify that project-level configs override user-level or global ones. After synthetic tests passed, we ran the parser against real config files already sitting on the machine. This confirmed the parser handles real-world config formats without needing paid accounts or live subscriptions active.

### 3. Transport Layers (Pipes & Local HTTP)
Once parsing worked, we tested the connections:
- **Subprocesses**: We checked that background processes spawn cleanly, talk over stdin/stdout pipes, and exit without leaving zombie processes behind.
- **Local HTTP**: We pointed health checks at a local daemon, timed the handshake, measured ping latency, and pulled the tool lists.

### 4. Running Tools
With connections healthy, we ran real commands through the tool runner. We picked safe, read-only queries (like listing status or workspaces) and confirmed arguments pass through properly, the response text renders cleanly in the UI, and bad inputs return readable error messages instead of hanging.

### 5. Packaging & Live Plugin Reload
Finally, we tested the build and installation flow:
- We verified that protocol libraries get bundled directly into the build so the plugin doesn't break on a machine without those packages installed globally.
- We installed the build into the running daemon, triggered a hot reload, watched the daemon logs to verify clean startup with no warnings, and clicked through the UI to verify everything loaded and ran.
