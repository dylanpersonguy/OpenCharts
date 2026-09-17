# Security Policy

## Scope

OpenCharts is a client-side application. It ships no server, no authentication
and no market-data feed: the bundled demo runs entirely in the browser against
historical data, and the paper-trading engine holds no real funds.

That shapes what a vulnerability looks like here. Reportable issues include:

- Cross-site scripting or injection through chart data, drawing payloads,
  symbol names, or anything else that flows into the DOM.
- Deserialization flaws in the persisted `localStorage` payloads (drawings,
  chart templates, preferences, journal entries).
- Dependency vulnerabilities that are reachable from this code.
- Anything that lets a page embedding OpenCharts reach data it should not.

If you are running a **fork wired to a real broker or exchange**, the
security of that adapter, its credentials and its order flow is yours. Please
report issues in your own adapter to your own team, not here — but if the
weakness is in the interface OpenCharts hands you, we want to hear about it.

## Reporting

Please report privately through GitHub's
[security advisories](https://github.com/dylanpersonguy/OpenCharts/security/advisories/new)
rather than opening a public issue.

Include what you found, how to reproduce it, and what an attacker gets. A
proof of concept helps. You will get an acknowledgement, and credit in the fix
unless you would rather not be named.

Please do not test against deployments you do not own.

## Supported versions

This is a young project with a single active line of development. Fixes land on
`main` and go out in the next tagged release; older tags are not patched.

## A standing caution

If you connect OpenCharts to a live trading account, treat the paper-engine
behaviour as a UI reference, not as an execution guarantee. The demo engine's
fills, margin maths and protective-order handling are deliberately simple and
are documented as such in the README.
