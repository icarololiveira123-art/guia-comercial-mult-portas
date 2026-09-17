"use client";

import { useEffect } from "react";

const replacements: Array<[RegExp, string]> = [
  [/\bPedreiros\b/g, "Prestadores de Serviço"],
  [/\bpedreiros\b/g, "prestadores de serviço"],
  [/\bPedreiro\b/g, "Prestador de Serviço"],
  [/\bpedreiro\b/g, "prestador de serviço"],
];

function normalizeText(value: string) {
  return replacements.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function normalizeSingleTextNode(node: Node) {
  if (node.nodeType !== Node.TEXT_NODE || !node.nodeValue) return;
  const parentTag = node.parentElement?.tagName;
  if (parentTag === "SCRIPT" || parentTag === "STYLE") return;
  const normalized = normalizeText(node.nodeValue);
  if (normalized !== node.nodeValue) node.nodeValue = normalized;
}

function normalizeAttributes(element: Element) {
  ["aria-label", "title", "placeholder"].forEach((attribute) => {
    const value = element.getAttribute(attribute);
    if (!value) return;
    const normalized = normalizeText(value);
    if (normalized !== value) element.setAttribute(attribute, normalized);
  });
}

function normalizeTextNodes(root: Node) {
  if (typeof document === "undefined") return;

  // React pode substituir um texto inteiro por um novo Text node. Nesse caso,
  // o próprio root precisa ser tratado antes de percorrer os descendentes.
  normalizeSingleTextNode(root);

  if (root.nodeType === Node.ELEMENT_NODE) {
    normalizeAttributes(root as Element);
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current = walker.nextNode();

  while (current) {
    if (current.nodeType === Node.TEXT_NODE) normalizeSingleTextNode(current);
    if (current.nodeType === Node.ELEMENT_NODE) normalizeAttributes(current as Element);
    current = walker.nextNode();
  }
}

export function TerminologyNormalizer() {
  useEffect(() => {
    const applyTerminology = () => normalizeTextNodes(document.body);

    applyTerminology();
    const frame = window.requestAnimationFrame(applyTerminology);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          normalizeSingleTextNode(mutation.target);
          continue;
        }

        if (mutation.type === "attributes" && mutation.target.nodeType === Node.ELEMENT_NODE) {
          normalizeAttributes(mutation.target as Element);
          continue;
        }

        mutation.addedNodes.forEach((node) => normalizeTextNodes(node));
      }
    });

    observer.observe(document.body, {
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["aria-label", "title", "placeholder"],
      subtree: true,
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return null;
}
