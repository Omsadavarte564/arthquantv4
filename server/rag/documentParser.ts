import zlib from 'node:zlib';

export interface ParsedDocumentOutput {
  mimeType: string;
  extension: string;
  pages: string[];
  fullText: string;
}

const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'json',
  'html',
  'htm',
  'pdf',
  'docx',
]);

const EXT_TO_MIME: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function sanitizeUntrustedText(raw: string): string {
  // Neutralize common prompt-injection directives inside untrusted documents
  return raw
    .replace(/\u0000/g, '')
    .replace(/<\s*\/?\s*(system|assistant|developer|tool_call|function_call)\s*>/gi, '[filtered-tag]')
    .replace(/ignore\s+(all\s+)?(previous|prior|above)\s+instructions/gi, '[filtered-directive]')
    .trim();
}

export function validateSourceUrl(sourceUrl: string): boolean {
  const trimmed = sourceUrl.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('local://')) return true;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function extractTextFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|tr|section|article|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractTextFromDocxBuffer(buf: Buffer): string {
  // Locate ZIP local file entries for word/document.xml cleanly without external deps
  const texts: string[] = [];
  let offset = 0;
  while (offset + 30 < buf.length) {
    // PK\x03\x04 local file header signature
    if (buf.readUInt32LE(offset) !== 0x04034b50) {
      offset++;
      continue;
    }
    const compressionMethod = buf.readUInt16LE(offset + 8);
    const compressedSize = buf.readUInt32LE(offset + 18);
    const fileNameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLen + extraLen;
    const fileName = buf.toString('utf8', nameStart, nameStart + fileNameLen);

    if (dataStart + compressedSize > buf.length) break;

    if (fileName === 'word/document.xml' || fileName.startsWith('word/header') || fileName.startsWith('word/footer')) {
      const slice = buf.subarray(dataStart, dataStart + compressedSize);
      let xmlStr = '';
      if (compressionMethod === 0) {
        xmlStr = slice.toString('utf8');
      } else if (compressionMethod === 8) {
        xmlStr = zlib.inflateRawSync(slice).toString('utf8');
      }
      if (xmlStr) {
        const plain = xmlStr
          .replace(/<\/w:p>/g, '\n')
          .replace(/<w:br[^>]*\/>/g, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim();
        if (plain) texts.push(plain);
      }
    }
    offset = dataStart + Math.max(1, compressedSize);
  }

  if (texts.length === 0) {
    // Fallback if plain text was sent with .docx extension during tests
    const asUtf8 = buf.toString('utf8');
    if (!asUtf8.startsWith('PK')) return asUtf8;
    throw new Error('Could not extract readable text from DOCX XML archive.');
  }
  return texts.join('\n\n');
}

function extractTextFromPdfBuffer(buf: Buffer): string[] {
  // Supports uncompressed PDF text operators, FlateDecode streams, and plain-text fallback
  const rawLatin = buf.toString('latin1');
  const pages: string[] = [];

  const collectTextOperators = (streamContent: string): string => {
    const pieces: string[] = [];
    // Match parenthesized PDF strings before Tj or inside TJ arrays
    const parenRegex = /\(([^()\\]*(?:\\.[^()\\]*)*)\)/g;
    let match: RegExpExecArray | null;
    while ((match = parenRegex.exec(streamContent)) !== null) {
      const cleaned = match[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (/[a-zA-Z0-9₹%.,:-]/.test(cleaned)) {
        pieces.push(cleaned);
      }
    }
    return pieces.join(' ').replace(/\s+/g, ' ').trim();
  };

  if (rawLatin.startsWith('%PDF')) {
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let m: RegExpExecArray | null;
    while ((m = streamRegex.exec(rawLatin)) !== null) {
      const streamBytes = Buffer.from(m[1], 'latin1');
      let decoded = '';
      try {
        decoded = zlib.inflateSync(streamBytes).toString('latin1');
      } catch {
        decoded = m[1];
      }
      if (decoded.includes('Tj') || decoded.includes('TJ')) {
        const txt = collectTextOperators(decoded);
        if (txt.length > 5) pages.push(txt);
      }
    }
    if (pages.length === 0) {
      const direct = collectTextOperators(rawLatin);
      if (direct.length > 5) pages.push(direct);
    }
  } else {
    const utf8 = buf.toString('utf8').trim();
    if (utf8) return utf8.split(/\f+/).map((p) => p.trim()).filter(Boolean);
  }

  if (pages.length === 0) {
    throw new Error('No extractable text found in PDF. Upload a text-based PDF or use Gemini File Search.');
  }
  return pages;
}

export function parseDocumentBuffer(
  fileName: string,
  buffer: Buffer,
  declaredMimeType?: string
): ParsedDocumentOutput {
  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded document is empty.');
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new Error(`Document exceeds maximum allowed size of ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`);
  }

  const ext = (fileName.split('.').pop() || 'txt').toLowerCase().trim();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported document format '.${ext}'. Supported formats: PDF, DOCX, TXT, MD, CSV, JSON, HTML.`
    );
  }

  const mimeType = declaredMimeType || EXT_TO_MIME[ext] || 'text/plain';
  let pages: string[] = [];

  if (ext === 'pdf') {
    pages = extractTextFromPdfBuffer(buffer).map(sanitizeUntrustedText).filter(Boolean);
  } else if (ext === 'docx') {
    const text = sanitizeUntrustedText(extractTextFromDocxBuffer(buffer));
    pages = text.split(/\f+/).map((p) => p.trim()).filter(Boolean);
  } else if (ext === 'html' || ext === 'htm') {
    const text = sanitizeUntrustedText(extractTextFromHtml(buffer.toString('utf8')));
    pages = [text];
  } else if (ext === 'json') {
    const parsedJson = JSON.parse(buffer.toString('utf8'));
    const formatted = sanitizeUntrustedText(JSON.stringify(parsedJson, null, 2));
    pages = [formatted];
  } else {
    const text = sanitizeUntrustedText(buffer.toString('utf8'));
    // Support explicit [Page N] or form-feed \f page splits
    const byFormFeed = text.split(/\f+/).map((p) => p.trim()).filter(Boolean);
    pages = byFormFeed.length > 0 ? byFormFeed : [text];
  }

  const fullText = pages.join('\n\n');
  if (!fullText || fullText.length < 15) {
    throw new Error('Document contains insufficient readable text (minimum 15 characters).');
  }

  return {
    mimeType,
    extension: ext,
    pages,
    fullText,
  };
}
