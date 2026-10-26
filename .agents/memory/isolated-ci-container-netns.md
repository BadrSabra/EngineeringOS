---
name: Isolated CI container network namespaces
description: Docker's private PID namespace changes what /proc/1 means during loopback-only smoke checks.
---

Inside a Docker container with a private PID namespace, `/proc/1/ns/net` identifies the container's init process, not the host network namespace. A strict loopback-only gate should compare the container namespace with a host namespace identity captured outside the container, while independently verifying the container's interfaces, IPv4/IPv6 routes, child-process namespace inheritance, and dropped capabilities.

**Why:** Treating container PID 1 as the host causes correctly isolated `--network none` runs to fail; using `--pid=host` to make the old comparison pass exposes host process information and is not an acceptable workaround.

**How to apply:** For future OS-isolated Docker smoke workflows, pass only the host namespace comparison value from the runner and retain all in-container topology and privilege checks. Never use host networking or host PID sharing as a fallback.

In the Replit runtime, direct `unshare --net` may be denied while `unshare --user --map-root-user --net` is permitted. `/sys/class/net` may still expose parent-container devices and `--mount-proc` may be denied, so inspect interface addresses with `os.networkInterfaces()` in the active namespace. A missing IPv6 route file is acceptable only after a local bind to `::1` proves the kernel returns `EAFNOSUPPORT` or `EPROTONOSUPPORT`. To run services without root-only tools, bring `lo` up in the parent user namespace, then enter a nested user namespace mapped to a nonzero UID; child processes inherit the isolated network namespace without network-administration capabilities.

**Why:** The namespace identity can be correct even when mounted sysfs/proc views are inherited from the outer runtime, and PostgreSQL refuses to initialize as UID 0.

**How to apply:** Verify the kernel-visible interfaces, routes, IPv6 support, and child namespace inheritance before starting services. Keep the egress gate fail-closed for any missing or ambiguous evidence.
