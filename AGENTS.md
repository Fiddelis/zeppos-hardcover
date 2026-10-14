# Project

Unofficial Hardcover companion miniapp for Zepp OS watches. Amazfit Bip 6 with Zepp on iPhone is the initial development target, not an exclusive product restriction. Distinguish OS device lists, configured build targets and hardware-tested compatibility. Support additional screen layouts only after adaptation and validation.

## Requirements

- Library sections use Hardcover terminology: Currently Reading, Want to Read, Read, in that order.
- Currently Reading comes first with a prominent cover, title and progress.
- Allow absolute current page and percentage input. Do not confuse current page with pages read during a session.
- HTTP requests and credentials belong in the phone side service, never the watch bundle.
- Download, convert and transfer covers using documented Zepp APIs. Do not pretend IMG accepts remote URLs.
- No paid features or payment integration until explicitly requested.
- Never log tokens. No real credentials in source, tests or documentation.
- Consult current official documentation and samples. State untested device behavior plainly.
- Use Node's built-in test runner for pure modules and mocked integration tests.

## Collaboration

Subagents may implement their assigned files. Do not overwrite another agent's files.
Lead agent reviews all implementation and runs tests/build checks.
