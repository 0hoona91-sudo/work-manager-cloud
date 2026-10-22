import test from "node:test";
import assert from "node:assert/strict";
import {
  readSitesIdentity,
  SIGN_IN_PATH,
  SIGN_OUT_PATH,
} from "../sites-adapter/identity.mjs";
const trusted = { trustedPlatformIngress: true, siteNamespace: "fixture-site" };
test("documented platform paths", () => {
  assert.equal(SIGN_IN_PATH, "/signin-with-chatgpt");
  assert.equal(SIGN_OUT_PATH, "/signout-with-chatgpt");
});
test("untrusted forged identity headers fail closed", () => {
  const r = new Request("https://site.example", {
    headers: { "oai-authenticated-user-email": "victim@example.com" },
  });
  assert.throws(() => readSitesIdentity(r));
});
test("signed out platform request has no identity", () => {
  assert.equal(
    readSitesIdentity(new Request("https://site.example"), trusted),
    null,
  );
});
test("verified boundary maps documented headers and uses email fallback", () => {
  const request = new Request("https://site.example", {
    headers: { "oai-authenticated-user-email": "A@example.com" },
  });
  assert.equal(readSitesIdentity(request, trusted).subject, "a@example.com");
  assert.equal(
    readSitesIdentity(request, trusted).displayName,
    "A@example.com",
  );
  request.headers.set("oai-authenticated-user-full-name", "Workspace User");
  assert.equal(
    readSitesIdentity(request, trusted).displayName,
    "Workspace User",
  );
});
test("separate site namespaces and malformed headers", () => {
  const request = new Request("https://site.example", {
    headers: { "oai-authenticated-user-email": "a@example.com,b@example.com" },
  });
  assert.throws(() => readSitesIdentity(request, trusted));
  assert.throws(() =>
    readSitesIdentity(request, { trustedPlatformIngress: true }),
  );
});
