import { z } from "zod";
import { listPaginated } from "@/lib/authentik/pagination";
import { resolveCertificatePk } from "@/lib/authentik/resolve";
import type { Schema } from "@/lib/authentik/types";
import { defineTool } from "../define-tool";

type KeyPair = Schema<"CertificateKeyPair">;

const DAY = 86_400_000;

const compactKeyPair = (kp: KeyPair) => ({
  pk: kp.pk,
  name: kp.name,
  subject: kp.cert_subject,
  expires: kp.cert_expiry,
  daysLeft: kp.cert_expiry ? Math.floor((Date.parse(kp.cert_expiry) - Date.now()) / DAY) : null,
  hasPrivateKey: kp.private_key_available,
  keyType: kp.key_type,
  fingerprintSha256: kp.fingerprint_sha256,
  managed: kp.managed || undefined,
});

async function allKeyPairs(client: Parameters<typeof listPaginated>[0], limit: number) {
  return listPaginated<KeyPair>(
    client,
    "/crypto/certificatekeypairs/",
    { ordering: "name" },
    limit,
  );
}

export const cryptoList = defineTool({
  name: "authentik_crypto_list",
  domain: "crypto",
  kind: "read",
  title: "List certificates",
  description: "List certificate-key pairs with expiry and whether a private key exists.",
  input: z.object({ search: z.string().max(200).optional(), hasKey: z.boolean().optional() }),
  handler: async (args, { client, env }) => {
    const page = await listPaginated<KeyPair>(
      client,
      "/crypto/certificatekeypairs/",
      { search: args.search, has_key: args.hasKey, ordering: "name" },
      env.MCP_MAX_PAGE_ITEMS,
    );
    return { total: page.total, certificates: page.results.map(compactKeyPair) };
  },
});

export const cryptoGet = defineTool({
  name: "authentik_crypto_get",
  domain: "crypto",
  kind: "read",
  title: "Get certificate",
  description: "Get a certificate (metadata and public PEM). The private key is never returned.",
  input: z.object({
    certificate: z.string().min(1).max(200).describe("Certificate name or uuid"),
    includePem: z.boolean().default(false),
  }),
  handler: async (args, { client }) => {
    const pk = await resolveCertificatePk(client, args.certificate);
    const kp = await client.get<KeyPair>(`/crypto/certificatekeypairs/${pk}/`);
    const pem = args.includePem
      ? (await client.get<{ data: string }>(`/crypto/certificatekeypairs/${pk}/view_certificate/`))
          .data
      : undefined;
    return { ...compactKeyPair(kp), certificatePem: pem };
  },
});

export const cryptoGenerate = defineTool({
  name: "authentik_crypto_generate",
  domain: "crypto",
  kind: "write",
  title: "Generate self-signed certificate",
  description: "Generate a new self-signed certificate-key pair (e.g. for token signing).",
  input: z.object({
    commonName: z.string().min(1).max(64),
    subjectAltNames: z.array(z.string().min(1).max(253)).max(20).optional(),
    validityDays: z.number().int().min(1).max(3650).default(365),
    algorithm: z.enum(["rsa", "ecdsa", "ed25519", "ed448"]).default("rsa"),
  }),
  handler: async (args, { client }) => {
    const kp = await client.post<KeyPair>("/crypto/certificatekeypairs/generate/", {
      common_name: args.commonName,
      subject_alt_name: args.subjectAltNames?.join(","),
      validity_days: args.validityDays,
      alg: args.algorithm,
    } satisfies Schema<"CertificateGenerationRequest">);
    return { created: true, certificate: compactKeyPair(kp) };
  },
});

export const cryptoExpiring = defineTool({
  name: "authentik_crypto_expiring",
  domain: "crypto",
  kind: "read",
  title: "Certificates expiring soon",
  description: "List certificates that expire within N days (default 30), including expired ones.",
  input: z.object({ days: z.number().int().min(1).max(3650).default(30) }),
  handler: async (args, { client }) => {
    const page = await allKeyPairs(client, 1000);
    const limit = Date.now() + args.days * DAY;
    const expiring = page.results
      .filter((kp) => kp.cert_expiry && Date.parse(kp.cert_expiry) <= limit)
      .map(compactKeyPair)
      .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
    return { withinDays: args.days, count: expiring.length, certificates: expiring };
  },
});

export const cryptoTools = [cryptoList, cryptoGet, cryptoGenerate, cryptoExpiring];
