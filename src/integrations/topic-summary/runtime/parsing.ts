import { XMLParser } from "fast-xml-parser";
import {
  asRecord,
  normalizeText,
  toArray
} from "../shared";
import { toText } from "../text";
import type { FeedEntry } from "../types";

export function parseFeedEntries(xml: string): FeedEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    trimValues: true,
    processEntities: true
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  const root = asRecord(parsed);
  if (!root) {
    return [];
  }
  if (root.rss && asRecord(root.rss)) {
    return parseRssLikeItems(asRecord(root.rss)!);
  }
  if (root.feed && asRecord(root.feed)) {
    return parseAtomEntries(asRecord(root.feed)!);
  }
  if (root["rdf:RDF"] && asRecord(root["rdf:RDF"])) {
    return parseRssRdfEntries(asRecord(root["rdf:RDF"])!);
  }
  if (root.channel && asRecord(root.channel)) {
    return parseRssLikeItems({ channel: root.channel });
  }
  return [];
}

function parseRssLikeItems(rssRoot: Record<string, unknown>): FeedEntry[] {
  const channel = asRecord(rssRoot.channel) ?? rssRoot;
  const items = toArray(channel.item)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return items.map((item) => ({
    title: normalizeText(toText(item.title)),
    link: extractLink(item.link),
    publishedAtRaw: normalizeText(toText(item.pubDate ?? item.published ?? item.updated)),
    summary: normalizeText(toText(item.description ?? item.summary ?? item["content:encoded"] ?? item.content))
  }));
}

function parseAtomEntries(feed: Record<string, unknown>): FeedEntry[] {
  const entries = toArray(feed.entry)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return entries.map((item) => ({
    title: normalizeText(toText(item.title)),
    link: extractAtomLink(item.link),
    publishedAtRaw: normalizeText(toText(item.published ?? item.updated)),
    summary: normalizeText(toText(item.summary ?? item.content ?? item["content:encoded"]))
  }));
}

function parseRssRdfEntries(rdf: Record<string, unknown>): FeedEntry[] {
  const items = toArray(rdf.item)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  return items.map((item) => ({
    title: normalizeText(toText(item.title)),
    link: extractLink(item.link),
    publishedAtRaw: normalizeText(toText(item["dc:date"] ?? item.pubDate ?? item.published)),
    summary: normalizeText(toText(item.description ?? item.summary ?? item["content:encoded"] ?? item.content))
  }));
}

function extractLink(raw: unknown): string {
  if (typeof raw === "string") {
    return normalizeText(raw);
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const link = extractLink(item);
      if (link) {
        return link;
      }
    }
    return "";
  }

  const source = asRecord(raw);
  if (!source) {
    return "";
  }

  return normalizeText(source["@_href"] ?? source.href ?? source["#text"] ?? source["$text"]);
}

function extractAtomLink(raw: unknown): string {
  const entries = toArray(raw)
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  for (const entry of entries) {
    const rel = normalizeText(entry["@_rel"] ?? entry.rel).toLowerCase();
    const href = normalizeText(entry["@_href"] ?? entry.href ?? entry["#text"]);
    if (href && (!rel || rel === "alternate" || rel === "self")) {
      return href;
    }
  }

  for (const entry of entries) {
    const href = normalizeText(entry["@_href"] ?? entry.href ?? entry["#text"]);
    if (href) {
      return href;
    }
  }

  return "";
}
