# Browser tests

Playwright is configured for Chromium desktop (1440px) and mobile (390px).
No E2E specifications exist in I1-03. Authentication scenarios will be added
with I1-06–09 and verified in I1-10 against the agreed backend environment.

The configuration does not start a server. Before running E2E, explicitly
authorize the required servers, browser installation and test execution.
Never use real user credentials or production data in fixtures.
