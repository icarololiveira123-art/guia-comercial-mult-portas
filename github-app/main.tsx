import { createRoot } from "react-dom/client";
import Home from "../app/page";
import { TerminologyNormalizer } from "../app/terminology-normalizer";
import "../app/globals.css";

const container = document.getElementById("root");
if (!container) throw new Error("Elemento principal do site não encontrado.");

createRoot(container).render(
  <>
    <TerminologyNormalizer />
    <Home />
  </>,
);
