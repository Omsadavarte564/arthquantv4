import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import {
  RagCitation,
  RagCollection,
  RagDocumentMetadata,
  RagDocumentStatus,
  RagRetrievalResult,
} from '../../src/types/trading.ts';
import { STOCK_UNIVERSE } from '../data/nseUniverse.ts';
import { formatNowIst } from '../quant/riskEngine.ts';
import { parseDocumentBuffer, validateSourceUrl } from './documentParser.ts';
import { SEED_KNOWLEDGE_DOCUMENTS } from './seedKnowledgeBase.ts';

export interface RagChunkRecord {
  chunkId: string;
  docId: string;
  pageNumber: number;
  chunkIndex: number;
  text: string;
  termFreq: Record<string, number>;
  tokenCount: number;
  embedding?: number[];
}

interface RagStoreState {
  schemaVersion: number;
  lastUpdatedIst: string;
  collectionStores: Partial<Record<RagCollection, string>>;
  documents: RagDocumentMetadata[];
  chunks: RagChunkRecord[];
}

export interface IngestDocumentInput {
  fileName: string;
  buffer: Buffer;
  mimeType?: string;
  title: string;
  sourceUrl: string;
  publisher: string;
  category: string;
  collection: RagCollection;
  publicationDate: string;
  effectiveDate?: string;
  exchangeOrCompany: string;
  relatedSymbol?: string;
  replaceDocId?: string;
  supersedeDocId?: string;
  skipRemoteSync?: boolean;
}

export interface UpdateDocumentInput {
  title?: string;
  category?: string;
  publisher?: string;
  sourceUrl?: string;
  collection?: RagCollection;
  publicationDate?: string;
  effectiveDate?: string;
  exchangeOrCompany?: string;
  relatedSymbol?: string;
  status?: RagDocumentStatus;
  newContent?: string;
  fileName?: string;
  skipRemoteSync?: boolean;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const RAG_STORE_FILE = path.join(DATA_DIR, 'rag-knowledge-base.json');

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'of', 'on', 'and', 'a', 'an', 'to', 'in', 'for', 'with', 'by',
  'from', 'or', 'as', 'are', 'be', 'this', 'that', 'it', 'its', 'was', 'were', 'can',
  'will', 'not', 'what', 'which', 'how', 'when', 'where', 'who', 'why', 'about', 'into',
  'per', 'all', 'any', 'only', 'also', 'more', 'than', 'most', 'very', 'has', 'have', 'had',
]);

const KNOWN_SYMBOLS = new Set(STOCK_UNIVERSE.map((s) => s.symbol));
const NAME_TO_SYMBOL: { token: string; symbol: string }[] = STOCK_UNIVERSE.map((s) => ({
  token: s.name.replace(/\b(ltd|limited|india|industries)\b/gi, '').trim().toUpperCase(),
  symbol: s.symbol,
})).filter((x) => x.token.length >= 3);

let memoryStore: RagStoreState | null = null;

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 10000,
      headers: { 'User-Agent': 'aistudio-build' },
    },
  });
}

export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .replace(/[^a-z0-9₹%.\-/]+/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[.-]+|[.-]+$/g, ''))
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
  return raw;
}

function buildTermFreq(tokens: string[]): Record<string, number> {
  const tf: Record<string, number> = {};
  for (const t of tokens) {
    tf[t] = (tf[t] || 0) + 1;
  }
  return tf;
}

function splitPagesIntoChunks(pages: string[], chunkSize = 680, overlap = 120): {
  pageNumber: number;
  chunkIndex: number;
  text: string;
}[] {
  const result: { pageNumber: number; chunkIndex: number; text: string }[] = [];
  let globalIdx = 0;

  for (let pIdx = 0; pIdx < pages.length; pIdx++) {
    const pageText = pages[pIdx].trim();
    if (!pageText) continue;

    if (pageText.length <= chunkSize) {
      result.push({ pageNumber: pIdx + 1, chunkIndex: globalIdx++, text: pageText });
      continue;
    }

    const paragraphs = pageText.split(/\n{2,}/);
    let buffer = '';
    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (buffer.length + trimmed.length + 2 <= chunkSize) {
        buffer = buffer ? `${buffer}\n\n${trimmed}` : trimmed;
      } else {
        if (buffer) {
          result.push({ pageNumber: pIdx + 1, chunkIndex: globalIdx++, text: buffer });
          const tail = buffer.slice(Math.max(0, buffer.length - overlap));
          buffer = `${tail}\n${trimmed}`.trim();
        } else {
          buffer = trimmed;
        }

        while (buffer.length > chunkSize) {
          let cut = buffer.lastIndexOf('. ', chunkSize);
          if (cut < chunkSize * 0.45) cut = buffer.lastIndexOf(' ', chunkSize);
          if (cut < chunkSize * 0.3) cut = chunkSize;
          const piece = buffer.slice(0, cut + 1).trim();
          if (piece) {
            result.push({ pageNumber: pIdx + 1, chunkIndex: globalIdx++, text: piece });
          }
          buffer = buffer.slice(Math.max(1, cut + 1 - overlap)).trim();
        }
      }
    }

    if (buffer.trim()) {
      result.push({ pageNumber: pIdx + 1, chunkIndex: globalIdx++, text: buffer.trim() });
    }
  }

  return result;
}

async function tryEmbedText(text: string): Promise<number[] | undefined> {
  const ai = getGeminiClient();
  if (!ai) return undefined;
  try {
    const res = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: text.slice(0, 2000),
    });
    const values = res.embeddings?.[0]?.values;
    if (Array.isArray(values) && values.length > 0) {
      return values;
    }
  } catch {
    // Graceful fallback to BM25 + TF-IDF
  }
  return undefined;
}

async function trySyncToGeminiFileSearch(
  store: RagStoreState,
  doc: RagDocumentMetadata,
  fullText: string
): Promise<{ synced: boolean; storeName?: string; docName?: string; error?: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      synced: false,
      error: 'GEMINI_API_KEY not configured; indexed locally in hybrid BM25/vector engine.',
    };
  }

  try {
    let storeName = store.collectionStores[doc.collection];
    if (!storeName) {
      const displayName = `arthquant-${doc.collection.toLowerCase()}`;
      const existingPager = await ai.fileSearchStores.list({ config: { pageSize: 20 } });
      for await (const s of existingPager) {
        if (s.displayName === displayName && s.name) {
          storeName = s.name;
          break;
        }
      }
      if (!storeName) {
        const created = await ai.fileSearchStores.create({
          config: { displayName },
        });
        storeName = created.name;
      }
      if (storeName) {
        store.collectionStores[doc.collection] = storeName;
      }
    }

    if (!storeName) {
      return { synced: false, error: 'Unable to resolve Gemini FileSearchStore name.' };
    }

    const blob = new Blob([fullText], { type: 'text/plain' });
    const operation = await ai.fileSearchStores.uploadToFileSearchStore({
      fileSearchStoreName: storeName,
      file: blob,
      config: {
        displayName: `${doc.title.slice(0, 80)} (v${doc.version})`,
        mimeType: 'text/plain',
        customMetadata: [
          { key: 'docId', stringValue: doc.docId },
          { key: 'collection', stringValue: doc.collection },
          { key: 'publisher', stringValue: doc.publisher },
          { key: 'publicationDate', stringValue: doc.publicationDate },
          ...(doc.relatedSymbol ? [{ key: 'relatedSymbol', stringValue: doc.relatedSymbol }] : []),
        ],
      },
    });

    return {
      synced: true,
      storeName,
      docName: operation.name,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      synced: false,
      storeName: store.collectionStores[doc.collection],
      error: `Gemini File Search sync skipped (${msg.slice(0, 180)}); local hybrid index active.`,
    };
  }
}

function saveStore(store: RagStoreState): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  store.lastUpdatedIst = formatNowIst();
  fs.writeFileSync(RAG_STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
  memoryStore = store;
}

function buildSeedStore(): RagStoreState {
  const nowIst = formatNowIst();
  const store: RagStoreState = {
    schemaVersion: 1,
    lastUpdatedIst: nowIst,
    collectionStores: {},
    documents: [],
    chunks: [],
  };

  for (const spec of SEED_KNOWLEDGE_DOCUMENTS) {
    const buf = Buffer.from(spec.content, 'utf-8');
    const parsed = parseDocumentBuffer(`${spec.title.replace(/[^a-z0-9]/gi, '_')}.md`, buf, 'text/markdown');
    const contentHash = crypto.createHash('sha256').update(parsed.fullText).digest('hex');
    const docId = `rag-${crypto.createHash('sha1').update(`${spec.collection}:${spec.title}`).digest('hex').slice(0, 10)}`;
    const rawChunks = splitPagesIntoChunks(parsed.pages);

    const chunkRecords: RagChunkRecord[] = rawChunks.map((rc) => {
      const tokens = tokenize(rc.text);
      return {
        chunkId: `${docId}-c${rc.chunkIndex}`,
        docId,
        pageNumber: rc.pageNumber,
        chunkIndex: rc.chunkIndex,
        text: rc.text,
        termFreq: buildTermFreq(tokens),
        tokenCount: tokens.length,
      };
    });

    const docMeta: RagDocumentMetadata = {
      docId,
      title: spec.title,
      sourceUrl: spec.sourceUrl,
      publisher: spec.publisher,
      category: spec.category,
      collection: spec.collection,
      publicationDate: spec.publicationDate,
      effectiveDate: spec.effectiveDate,
      uploadDate: nowIst,
      lastUpdatedDate: nowIst,
      version: 1,
      exchangeOrCompany: spec.exchangeOrCompany,
      relatedSymbol: spec.relatedSymbol,
      status: 'ACTIVE',
      indexingStatus: 'INDEXED',
      contentHash,
      mimeType: parsed.mimeType,
      sizeBytes: buf.length,
      chunkCount: chunkRecords.length,
      pageCount: parsed.pages.length,
      geminiFileSearchSynced: false,
      indexingError: 'Indexed locally in hybrid BM25/vector engine (seed corpus).',
    };

    store.documents.push(docMeta);
    store.chunks.push(...chunkRecords);
  }

  saveStore(store);
  return store;
}

function loadStore(): RagStoreState {
  if (memoryStore) return memoryStore;
  try {
    if (fs.existsSync(RAG_STORE_FILE)) {
      const raw = fs.readFileSync(RAG_STORE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as RagStoreState;
      if (Array.isArray(parsed.documents) && Array.isArray(parsed.chunks)) {
        memoryStore = parsed;
        return parsed;
      }
    }
  } catch {
    // Rebuild cleanly if corrupt
  }
  return buildSeedStore();
}

export function resetRagStoreForTests(): void {
  memoryStore = null;
  if (fs.existsSync(RAG_STORE_FILE)) {
    fs.unlinkSync(RAG_STORE_FILE);
  }
  loadStore();
}

export function listRagDocuments(filter?: {
  q?: string;
  collection?: RagCollection | 'ALL';
  status?: RagDocumentStatus | 'ALL';
  symbol?: string;
}): {
  documents: RagDocumentMetadata[];
  countsByCollection: Record<RagCollection, number>;
  totalChunks: number;
} {
  const store = loadStore();
  const countsByCollection: Record<RagCollection, number> = {
    INDIAN_MARKET: 0,
    COMPANY_INFO: 0,
    FINANCIAL_NEWS_RESEARCH: 0,
    TRADING_KNOWLEDGE: 0,
    REGULATORY_COMPLIANCE: 0,
  };

  for (const d of store.documents) {
    if (d.status !== 'ARCHIVED') {
      countsByCollection[d.collection] = (countsByCollection[d.collection] || 0) + 1;
    }
  }

  let docs = [...store.documents];
  if (filter?.collection && filter.collection !== 'ALL') {
    docs = docs.filter((d) => d.collection === filter.collection);
  }
  if (filter?.status && filter.status !== 'ALL') {
    docs = docs.filter((d) => d.status === filter.status);
  }
  if (filter?.symbol) {
    const sym = filter.symbol.toUpperCase().trim();
    docs = docs.filter((d) => d.relatedSymbol?.toUpperCase() === sym);
  }
  if (filter?.q) {
    const q = filter.q.toLowerCase().trim();
    docs = docs.filter(
      (d) =>
        d.title.toLowerCase().includes(q) ||
        d.publisher.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.exchangeOrCompany.toLowerCase().includes(q) ||
        (d.relatedSymbol && d.relatedSymbol.toLowerCase().includes(q))
    );
  }

  docs.sort((a, b) => b.lastUpdatedDate.localeCompare(a.lastUpdatedDate));

  return {
    documents: docs,
    countsByCollection,
    totalChunks: store.chunks.length,
  };
}

export function getRagDocumentById(docId: string): {
  document: RagDocumentMetadata;
  chunks: RagChunkRecord[];
} | null {
  const store = loadStore();
  const document = store.documents.find((d) => d.docId === docId);
  if (!document) return null;
  const chunks = store.chunks.filter((c) => c.docId === docId);
  return { document, chunks };
}

export async function ingestRagDocument(input: IngestDocumentInput): Promise<RagDocumentMetadata> {
  if (!input.title.trim()) throw new Error('Document title is required.');
  if (!input.publisher.trim()) throw new Error('Publisher name is required.');
  if (!validateSourceUrl(input.sourceUrl)) {
    throw new Error('Valid sourceUrl starting with https://, http://, or local:// is required.');
  }

  const parsed = parseDocumentBuffer(input.fileName, input.buffer, input.mimeType);
  const contentHash = crypto.createHash('sha256').update(parsed.fullText).digest('hex');
  const store = loadStore();

  // Duplicate content detection unless intentionally updating/replacing
  const existingDuplicate = store.documents.find(
    (d) =>
      d.contentHash === contentHash &&
      d.status !== 'ARCHIVED' &&
      d.docId !== input.replaceDocId
  );
  if (existingDuplicate) {
    const err = Object.assign(
      new Error(`Duplicate document content already indexed under '${existingDuplicate.title}' (${existingDuplicate.docId}).`),
      { statusCode: 409, existingDocId: existingDuplicate.docId }
    );
    throw err;
  }

  const nowIst = formatNowIst();
  let version = 1;
  let docId = `rag-${crypto.randomUUID().slice(0, 10)}`;

  if (input.replaceDocId) {
    const target = store.documents.find((d) => d.docId === input.replaceDocId);
    if (!target) throw new Error(`Document '${input.replaceDocId}' not found.`);
    version = target.version + 1;
    docId = target.docId;
    store.documents = store.documents.filter((d) => d.docId !== docId);
    store.chunks = store.chunks.filter((c) => c.docId !== docId);
  } else if (input.supersedeDocId) {
    const oldDoc = store.documents.find((d) => d.docId === input.supersedeDocId);
    if (oldDoc) {
      version = oldDoc.version + 1;
      oldDoc.status = 'SUPERSEDED';
      oldDoc.supersededByDocId = docId;
      oldDoc.lastUpdatedDate = nowIst;
    }
  }

  const rawChunks = splitPagesIntoChunks(parsed.pages);
  const chunkRecords: RagChunkRecord[] = [];
  for (const rc of rawChunks) {
    const tokens = tokenize(rc.text);
    const embedding = !input.skipRemoteSync ? await tryEmbedText(rc.text) : undefined;
    chunkRecords.push({
      chunkId: `${docId}-v${version}-c${rc.chunkIndex}`,
      docId,
      pageNumber: rc.pageNumber,
      chunkIndex: rc.chunkIndex,
      text: rc.text,
      termFreq: buildTermFreq(tokens),
      tokenCount: tokens.length,
      embedding,
    });
  }

  const docMeta: RagDocumentMetadata = {
    docId,
    title: input.title.trim(),
    sourceUrl: input.sourceUrl.trim(),
    publisher: input.publisher.trim(),
    category: input.category.trim() || 'General Research',
    collection: input.collection,
    publicationDate: input.publicationDate || nowIst.slice(0, 10),
    effectiveDate: input.effectiveDate || input.publicationDate || nowIst.slice(0, 10),
    uploadDate: nowIst,
    lastUpdatedDate: nowIst,
    version,
    exchangeOrCompany: input.exchangeOrCompany.trim() || 'NSE',
    relatedSymbol: input.relatedSymbol ? input.relatedSymbol.toUpperCase().trim() : undefined,
    status: 'ACTIVE',
    indexingStatus: 'INDEXED',
    contentHash,
    mimeType: parsed.mimeType,
    sizeBytes: input.buffer.length,
    chunkCount: chunkRecords.length,
    pageCount: parsed.pages.length,
    geminiFileSearchSynced: false,
  };

  if (!input.skipRemoteSync) {
    const remote = await trySyncToGeminiFileSearch(store, docMeta, parsed.fullText);
    docMeta.geminiFileSearchSynced = remote.synced;
    docMeta.geminiFileSearchStoreName = remote.storeName;
    docMeta.geminiFileSearchDocName = remote.docName;
    if (remote.error) {
      docMeta.indexingError = remote.error;
    }
  }

  store.documents.unshift(docMeta);
  store.chunks.push(...chunkRecords);
  saveStore(store);

  return docMeta;
}

export async function updateRagDocument(
  docId: string,
  patch: UpdateDocumentInput
): Promise<RagDocumentMetadata> {
  const store = loadStore();
  const existing = store.documents.find((d) => d.docId === docId);
  if (!existing) {
    throw new Error(`Document '${docId}' not found.`);
  }

  if (patch.sourceUrl && !validateSourceUrl(patch.sourceUrl)) {
    throw new Error('Invalid sourceUrl format.');
  }

  if (patch.newContent && patch.newContent.trim().length > 0) {
    return ingestRagDocument({
      fileName: patch.fileName || `${(patch.title || existing.title).replace(/[^a-z0-9]/gi, '_')}.md`,
      buffer: Buffer.from(patch.newContent, 'utf-8'),
      title: patch.title ?? existing.title,
      sourceUrl: patch.sourceUrl ?? existing.sourceUrl,
      publisher: patch.publisher ?? existing.publisher,
      category: patch.category ?? existing.category,
      collection: patch.collection ?? existing.collection,
      publicationDate: patch.publicationDate ?? existing.publicationDate,
      effectiveDate: patch.effectiveDate ?? existing.effectiveDate,
      exchangeOrCompany: patch.exchangeOrCompany ?? existing.exchangeOrCompany,
      relatedSymbol: patch.relatedSymbol ?? existing.relatedSymbol,
      replaceDocId: docId,
      skipRemoteSync: patch.skipRemoteSync,
    });
  }

  if (patch.title) existing.title = patch.title.trim();
  if (patch.category) existing.category = patch.category.trim();
  if (patch.publisher) existing.publisher = patch.publisher.trim();
  if (patch.sourceUrl) existing.sourceUrl = patch.sourceUrl.trim();
  if (patch.collection) existing.collection = patch.collection;
  if (patch.publicationDate) existing.publicationDate = patch.publicationDate;
  if (patch.effectiveDate) existing.effectiveDate = patch.effectiveDate;
  if (patch.exchangeOrCompany) existing.exchangeOrCompany = patch.exchangeOrCompany.trim();
  if (patch.relatedSymbol !== undefined) {
    existing.relatedSymbol = patch.relatedSymbol ? patch.relatedSymbol.toUpperCase().trim() : undefined;
  }
  if (patch.status) existing.status = patch.status;
  existing.lastUpdatedDate = formatNowIst();
  existing.version += 1;

  saveStore(store);
  return existing;
}

export async function deleteRagDocument(docId: string): Promise<{ deleted: boolean; docId: string }> {
  const store = loadStore();
  const idx = store.documents.findIndex((d) => d.docId === docId);
  if (idx === -1) {
    throw new Error(`Document '${docId}' not found.`);
  }
  const [removed] = store.documents.splice(idx, 1);
  store.chunks = store.chunks.filter((c) => c.docId !== docId);

  if (removed.geminiFileSearchSynced && removed.geminiFileSearchDocName) {
    const ai = getGeminiClient();
    if (ai) {
      try {
        await ai.fileSearchStores.documents.delete({
          name: removed.geminiFileSearchDocName,
          config: { force: true },
        });
      } catch {
        // Remote cleanup best-effort
      }
    }
  }

  saveStore(store);
  return { deleted: true, docId };
}

export function classifyRagQuery(query: string): {
  collections: RagCollection[];
  detectedSymbol?: string;
  prioritizeLatestRegulatory: boolean;
} {
  const q = query.toUpperCase();
  const collections = new Set<RagCollection>();

  // Detect stock symbol
  let detectedSymbol: string | undefined;
  const words = q.replace(/[^A-Z0-9&-]+/g, ' ').split(/\s+/);
  for (const w of words) {
    if (KNOWN_SYMBOLS.has(w)) {
      detectedSymbol = w;
      break;
    }
  }
  if (!detectedSymbol) {
    for (const entry of NAME_TO_SYMBOL) {
      if (q.includes(entry.token)) {
        detectedSymbol = entry.symbol;
        break;
      }
    }
  }

  const isReg = /\b(SEBI|CIRCULAR|COMPLIANCE|REGULAT|STATIC IP|ALGO|TAGGING|BROKER API|TOTP|OAUTH|ZERODHA|UPSTOX|DHAN|ANGEL|MARGIN|VAR|PENALTY|CLEARING|RULE|MANDATE)\b/.test(q);
  const isMarket = /\b(NSE|BSE|HOLIDAY|SESSION|PRE-OPEN|MARKET TIMING|SQUARE-OFF|MIS|TICK SIZE)\b/.test(q);
  const isCompany = Boolean(detectedSymbol) || /\b(EARNINGS|FILING|ANNUAL REPORT|CONCALL|RISK FACTOR|RELIANCE|INFOSYS|INFY|TCS|HDFC|BALANCE SHEET|GUIDANCE)\b/.test(q);
  const isTrading = /\b(VWAP|RSI|ADX|SUPERTREND|ORB|ATR|BACKTEST|WALK-FORWARD|EMBARGO|LOOKAHEAD|REGIME|UNCERTAIN_CHOP|INDICATOR|STRATEGY)\b/.test(q);
  const isNewsOrCosts = /\b(STT|STAMP DUTY|BROKERAGE|GST|IPFT|TRANSACTION CHARGE|MACRO|RBI|INFLATION|NEWS|RESEARCH)\b/.test(q);

  if (isReg) collections.add('REGULATORY_COMPLIANCE');
  if (isMarket) collections.add('INDIAN_MARKET');
  if (isCompany) collections.add('COMPANY_INFO');
  if (isTrading) collections.add('TRADING_KNOWLEDGE');
  if (isNewsOrCosts) collections.add('FINANCIAL_NEWS_RESEARCH');

  if (collections.size === 0) {
    // Search across all 5 collections cleanly when query intent spans topics
    collections.add('INDIAN_MARKET');
    collections.add('COMPANY_INFO');
    collections.add('FINANCIAL_NEWS_RESEARCH');
    collections.add('TRADING_KNOWLEDGE');
    collections.add('REGULATORY_COMPLIANCE');
  }

  return {
    collections: Array.from(collections),
    detectedSymbol,
    prioritizeLatestRegulatory: isReg || /\b(LATEST|CURRENT|EFFECTIVE|UPDATED)\b/.test(q),
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

function jaccardTextOverlap(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) {
    if (sb.has(t)) inter++;
  }
  return inter / (sa.size + sb.size - inter);
}

export async function retrieveRagContext(
  query: string,
  options?: {
    collections?: RagCollection[];
    symbol?: string;
    topK?: number;
    includeSuperseded?: boolean;
    minScore?: number;
  }
): Promise<RagRetrievalResult> {
  const store = loadStore();
  const classification = classifyRagQuery(query);
  const explicitCollections =
    options?.collections && options.collections.length > 0 ? options.collections : null;
  const targetCollections = explicitCollections ?? classification.collections;
  const targetSymbol = options?.symbol?.toUpperCase() || classification.detectedSymbol;
  const topK = Math.max(1, Math.min(10, options?.topK || 5));
  const minScore = options?.minScore ?? 0.24;

  const docMap = new Map<string, RagDocumentMetadata>();
  for (const d of store.documents) {
    if (d.status === 'ARCHIVED') continue;
    if (!options?.includeSuperseded && d.status === 'SUPERSEDED') continue;
    // Hard-filter ONLY when caller explicitly requests specific collections
    if (explicitCollections && !explicitCollections.includes(d.collection) && !(targetSymbol && d.relatedSymbol === targetSymbol)) {
      continue;
    }
    docMap.set(d.docId, d);
  }

  const eligibleChunks = store.chunks.filter((c) => docMap.has(c.docId));
  const queryTokens = tokenize(query);

  if (queryTokens.length === 0 || eligibleChunks.length === 0) {
    return {
      query,
      classifiedCollections: targetCollections,
      detectedSymbol: targetSymbol,
      prioritizeLatestRegulatory: classification.prioritizeLatestRegulatory,
      sufficientEvidence: false,
      confidenceScore: 0,
      citations: [],
      engineUsed: 'LOCAL_HYBRID_VECTOR_BM25',
      noResultReason: 'Insufficient indexed documents matching query tokens.',
    };
  }

  // Compute IDF across eligible chunks
  const N = Math.max(1, eligibleChunks.length);
  const avgLen =
    eligibleChunks.reduce((acc, c) => acc + Math.max(1, c.tokenCount), 0) / N;
  const dfMap = new Map<string, number>();
  for (const qt of new Set(queryTokens)) {
    let df = 0;
    for (const c of eligibleChunks) {
      if ((c.termFreq[qt] || 0) > 0) df++;
    }
    dfMap.set(qt, df);
  }

  // Optional query vector if chunks have embeddings
  const anyEmbeddings = eligibleChunks.some((c) => Array.isArray(c.embedding) && c.embedding.length > 0);
  const queryEmbedding = anyEmbeddings ? await tryEmbedText(query) : undefined;

  const k1 = 1.4;
  const b = 0.75;
  const scored: { chunk: RagChunkRecord; doc: RagDocumentMetadata; score: number }[] = [];

  for (const chunk of eligibleChunks) {
    const doc = docMap.get(chunk.docId)!;
    let bm25 = 0;
    let matchedUniqueTokens = 0;

    for (const qt of new Set(queryTokens)) {
      const tf = chunk.termFreq[qt] || 0;
      const titleHit = doc.title.toLowerCase().includes(qt) ? 1.2 : 0;
      const effTf = tf + titleHit;
      if (effTf > 0) {
        matchedUniqueTokens++;
        const df = dfMap.get(qt) || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const denom = effTf + k1 * (1 - b + b * (Math.max(1, chunk.tokenCount) / avgLen));
        bm25 += idf * ((effTf * (k1 + 1)) / denom);
      }
    }

    const coverage = matchedUniqueTokens / Math.max(1, new Set(queryTokens).size);
    const normalizedBm25 = bm25 / Math.max(1.5, queryTokens.length * 1.15);

    let vecScore = 0;
    if (queryEmbedding && chunk.embedding) {
      vecScore = Math.max(0, cosineSimilarity(queryEmbedding, chunk.embedding));
    }

    let metaBoost = 0;
    if (classification.collections.includes(doc.collection)) {
      metaBoost += 0.06;
    }
    if (targetSymbol && doc.relatedSymbol === targetSymbol) {
      metaBoost += 0.18;
    }
    if (doc.status === 'ACTIVE') {
      metaBoost += 0.04;
    }
    if (classification.prioritizeLatestRegulatory && doc.collection === 'REGULATORY_COMPLIANCE') {
      // Slight recency boost based on effectiveDate year
      const year = Number(doc.effectiveDate.slice(0, 4)) || 2025;
      metaBoost += Math.max(0, (year - 2024) * 0.03);
    }

    // Require at least minimal lexical overlap unless vector similarity is strong
    if (matchedUniqueTokens === 0 && vecScore < 0.55) {
      continue;
    }

    const totalScore = Math.min(
      1,
      Number((normalizedBm25 * 0.55 + coverage * 0.35 + vecScore * 0.25 + metaBoost).toFixed(4))
    );

    if (totalScore >= minScore) {
      scored.push({ chunk, doc, score: totalScore });
    }
  }

  scored.sort((a, b) => {
    if (Math.abs(b.score - a.score) > 0.04) return b.score - a.score;
    return b.doc.effectiveDate.localeCompare(a.doc.effectiveDate);
  });

  // Deduplicate near-identical snippets & repeated doc/page pairs
  const citations: RagCitation[] = [];
  const seenDocPage = new Set<string>();

  for (const item of scored) {
    const dpKey = `${item.doc.docId}:${item.chunk.pageNumber}`;
    if (seenDocPage.has(dpKey)) continue;
    if (citations.some((c) => jaccardTextOverlap(c.excerpt, item.chunk.text) > 0.72)) {
      continue;
    }
    seenDocPage.add(dpKey);
    citations.push({
      docId: item.doc.docId,
      chunkId: item.chunk.chunkId,
      title: item.doc.title,
      collection: item.doc.collection,
      category: item.doc.category,
      publisher: item.doc.publisher,
      sourceUrl: item.doc.sourceUrl,
      publicationDate: item.doc.publicationDate,
      effectiveDate: item.doc.effectiveDate,
      relatedSymbol: item.doc.relatedSymbol,
      pageNumber: item.chunk.pageNumber,
      score: Number(item.score.toFixed(3)),
      status: item.doc.status,
      excerpt: item.chunk.text.slice(0, 460),
    });
    if (citations.length >= topK) break;
  }

  const topScore = citations[0]?.score ?? 0;
  const sufficientEvidence = citations.length > 0 && topScore >= minScore;

  return {
    query,
    classifiedCollections: targetCollections,
    detectedSymbol: targetSymbol,
    prioritizeLatestRegulatory: classification.prioritizeLatestRegulatory,
    sufficientEvidence,
    confidenceScore: Number(topScore.toFixed(3)),
    citations,
    engineUsed: store.documents.some((d) => d.geminiFileSearchSynced)
      ? 'HYBRID_BM25_VECTOR_WITH_FILE_SEARCH'
      : 'LOCAL_HYBRID_VECTOR_BM25',
    noResultReason: sufficientEvidence
      ? undefined
      : `No indexed passages cleared confidence threshold (${minScore}). Upload a relevant PDF/DOCX/MD document into AI Knowledge Base or verify the topic.`,
  };
}
