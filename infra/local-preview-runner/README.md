# Local Preview Runner Host Preflight

Run this read-only inventory on the dedicated Linux host, as the same
unprivileged account intended to run the Preview Agent:

```sh
node infra/local-preview-runner/host-preflight.mjs
```

It reads basic kernel/cgroup settings, checks the current account's access to
`/dev/kvm`, and checks whether `runsc`, `firecracker`, `jailer`, or `runc` is
present on `PATH`. It does not execute those binaries, install software, change
permissions, contact a network, or run Candidate code. It reads `PATH` only to
locate runtime filenames; it does not print `PATH` or any other environment
value.

The JSON is **diagnostic only**. It deliberately always reports
`candidateExecutionAllowed: false`; presence of a runtime or KVM device does not
qualify a Runner. Independent tests must still prove the exact runtime and
policy, filesystem/network boundaries, secrets isolation, resource limits,
session channel, lifecycle, and cleanup. The server's qualification registry
remains empty until that evidence is reviewed and approved.

The output includes no host paths or environment values. It can be shared for
planning, but do not include private keys, tokens, or other credentials in any
additional notes.

Run the fixture tests from the workspace with:

```sh
node --test infra/local-preview-runner/host-preflight.test.mjs
```
