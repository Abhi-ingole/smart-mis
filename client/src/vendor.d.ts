// pdf.js legacy build (wider browser support). Its worker is used in-thread as the "fake worker".
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
declare module "pdfjs-dist/legacy/build/pdf.mjs" {
  export * from "pdfjs-dist";
}
