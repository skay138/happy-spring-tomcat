import { DOMParser, XMLSerializer, Document } from '@xmldom/xmldom';

export function parseXml(contents: string, rootName: string): Document {
    const document = new DOMParser({
        onError: (_level, message) => { throw new Error(`Invalid ${rootName} XML: ${message}`); }
    }).parseFromString(contents, 'application/xml');
    if (document.documentElement?.tagName !== rootName) {
        throw new Error(`Expected a ${rootName} XML document.`);
    }
    return document;
}

export const serializeXml = (document: Document): string => new XMLSerializer().serializeToString(document);
