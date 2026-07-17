// Crown Tracker deliberately does not cache authenticated HTML or market data.
// Registration makes the app installable while each visit continues to receive
// fresh server-rendered research and session state.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
