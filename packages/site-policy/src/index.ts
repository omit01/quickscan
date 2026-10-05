import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const blockedHostnames = new Set(["localhost", "metadata.google.internal", "metadata.azure.com"]);

export function parsePublicWebUrl(value: string): URL {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Alleen http- en https-URL's zijn toegestaan.");
  if (url.username || url.password) throw new Error("URL's met gebruikersgegevens zijn niet toegestaan.");
  if (url.port && url.port !== "80" && url.port !== "443") throw new Error("Alleen poorten 80 en 443 zijn toegestaan.");
  if (blockedHostnames.has(url.hostname.toLowerCase())) throw new Error("Interne adressen mogen niet worden gescand.");
  return url;
}

export async function assertPublicWebUrl(value: string): Promise<URL> {
  const url = parsePublicWebUrl(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (addresses.length === 0 || addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new Error("De URL verwijst naar een intern of gereserveerd netwerkadres.");
  }

  return url;
}

function isBlockedAddress(address: string): boolean {
  return !ipaddr.isValid(address) || ipaddr.process(address).range() !== "unicast";
}