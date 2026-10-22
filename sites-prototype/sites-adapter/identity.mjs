/**
 * Documented Sites identity contract, NOT an enabled public authentication API.
 * Call only inside a platform-protected server handler after confirming that
 * client-supplied oai-authenticated-* headers are stripped/overwritten by Sites.
 * Never set trustedPlatformIngress from a URL, cookie, request body or header.
 * https://learn.chatgpt.com/docs/sites/data-and-connections
 */
export const SIGN_IN_PATH = "/signin-with-chatgpt";
export const SIGN_OUT_PATH = "/signout-with-chatgpt";

export function readSitesIdentity(
  request,
  { trustedPlatformIngress = false, siteNamespace = "" } = {},
) {
  if (!trustedPlatformIngress)
    throw new Error("Sites platform ingress has not been verified");
  if (!siteNamespace || /\s/.test(siteNamespace))
    throw new Error("A stable server-side site namespace is required");
  const email = request.headers.get("oai-authenticated-user-email")?.trim();
  if (!email) return null;
  if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(email) || email.length > 254) {
    throw new Error("Invalid platform identity header");
  }
  const name = request.headers.get("oai-authenticated-user-full-name")?.trim();
  // Documentation exposes email, not a stable account subject. Do not invent a UID.
  // Email changes/reassignment require an explicit account-mapping policy before rollout.
  return Object.freeze({
    issuer: `sites:${siteNamespace}`,
    subject: email.toLowerCase(),
    displayName: (name || email).slice(0, 100),
    email,
  });
}
