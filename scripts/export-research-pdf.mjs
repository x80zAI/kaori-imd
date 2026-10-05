import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const publicRoot = join(project, 'public');
const output = join(publicRoot, 'research', 'Kaori-IMD-Research.pdf');
const playwrightModule = process.env.PLAYWRIGHT_MODULE_URL;
if (!playwrightModule) {
  throw new Error('Set PLAYWRIGHT_MODULE_URL to the installed Playwright module URL.');
}
const { chromium } = await import(playwrightModule);

const mediaTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(publicRoot, `.${pathname}`);
    if (!file.startsWith(`${publicRoot}${sep}`) || !(await stat(file)).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': mediaTypes[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((accept) => server.listen(0, '127.0.0.1', accept));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${origin}/research/kaori.html`, { waitUntil: 'networkidle' });
  await page.emulateMedia({ media: 'print' });
  await page.addStyleTag({ content: `
    @page { size: A4; }
    body { color: #171c2c; line-height: 1.55; }
    .paper { padding: 0; border-top: 3px solid #b72e48; }
    .paper-label { margin-top: 15px; font-size: 8px; }
    .paper-hero h1 { font-size: 26pt; line-height: 1.12; margin: 22px 0 18px; }
    .paper-subtitle { font-size: 12pt; line-height: 1.4; }
    .paper-meta { font-size: 8pt; }
    .publication-note { font-size: 8pt; line-height: 1.55; }
    .paper-keywords { font-size: 7.5pt; line-height: 1.6; }
    .paper-intro { margin: 20px 0 24px; padding: 13px 15px; }
    .paper-intro p { font-size: 10pt; }
    .paper-section { margin-top: 22px; padding-top: 0; }
    .paper-section h2 { font-size: 15pt; line-height: 1.35; margin-bottom: 13px; padding-bottom: 8px; break-after: avoid-page; }
    .paper-section h3 { font-size: 11.5pt; line-height: 1.4; margin-top: 20px; margin-bottom: 10px; break-after: avoid-page; }
    .paper-section p { font-size: 10pt; line-height: 1.55; margin-bottom: 12px; orphans: 3; widows: 3; }
    .paper-section code { font-size: 8pt; }
    .table-wrap { margin: 16px 0; break-inside: avoid-page; }
    table { font-size: 8.5pt; line-height: 1.45; }
    th, td { padding: 8px 10px; }
    .equation { padding: 12px; margin: 17px 0; break-inside: avoid-page; }
    .equation code { font-size: 9pt; }
    .references-list { gap: 13px; }
    #references-and-source-record { break-before: page; margin-top: 0; }
    .references-list li { font-size: 8.5pt; line-height: 1.5; break-inside: avoid-page; }
    .source-link { font-size: 7pt; line-height: 1.5; margin-top: 4px; overflow-wrap: anywhere; }
    .source-link::after { content: ' - ' attr(href); }
    .citations { font-size: 7.5pt; }
    a { color: #8c2036; }
  ` });
  // The published source keeps its original typography; the export uses ASCII hyphens.
  await page.evaluate(() => {
    const iterator = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (iterator.nextNode()) {
      iterator.currentNode.textContent = iterator.currentNode.textContent.replace(/[\u2010-\u2015]/g, '-');
    }
  });
  await page.pdf({
    path: output,
    format: 'A4',
    printBackground: true,
    displayHeaderFooter: true,
    margin: { top: '18mm', bottom: '19mm', left: '20mm', right: '20mm' },
    headerTemplate: '<div></div>',
    footerTemplate: '<div style="width:100%;margin:0 20mm;border-top:1px solid #d5cfc2;padding-top:8px;font-family:Arial,sans-serif;font-size:8px;color:#625e66;display:flex;justify-content:space-between;"><span>KAORI IMD / RESEARCH 001 / 5 OCTOBER 2026</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>',
    tagged: true,
    outline: true,
  });
  console.log(`Created ${output}`);
} finally {
  if (browser) await browser.close();
  await new Promise((accept, reject) => server.close((error) => error ? reject(error) : accept()));
}
