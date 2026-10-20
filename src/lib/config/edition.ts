/**
 * authentik edition this server targets. Only open-source features are implemented;
 * an Enterprise module can later be gated on this constant.
 */
export const AUTHENTIK_EDITION = "oss" as const;

export type AuthentikEdition = typeof AUTHENTIK_EDITION;
