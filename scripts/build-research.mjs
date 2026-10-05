import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'docs/kaori-research-article.md'), 'utf8');
const policy = await readFile(resolve(root, 'docs/kaori-fuel-policy.md'), 'utf8');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function inline(text) {
  return escape(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[(\d+(?:\s*[,–-]\s*\d+)*)\]/g, (_match, values) => {
    const ids = values.split(',').flatMap(value => {
      const range = value.trim().split(/[–-]/).map(Number);
      return range.length === 2 ? Array.from({ length: range[1] - range[0] + 1 }, (_, i) => range[0] + i) : range;
    });
    return `<span class="citations">${ids.map(id => `<a href="#ref-${id}" aria-label="Reference ${id}">[${id}]</a>`).join(' ')}</span>`;
  });
}
const title = source.split('\n')[0].replace(/^# /, '').trim();
const subtitle = source.split('\n').find(line => line.startsWith('## ')).slice(3).trim();
const body = source.slice(source.indexOf('## Abstract'));
const blocks = body.trim().split(/\r?\n\s*\r?\n/);
const contents = [];
let sectionOpen = false;
let inReferences = false;
const html = blocks.map(block => {
  const lines = block.split(/\r?\n/);
  if (/^## /.test(block)) {
    const heading = lines[0].slice(3).trim();
    const id = heading.toLowerCase().replace(/^\d+\.\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/-$/, '');
    contents.push({ id, heading });
    inReferences = heading.startsWith('References');
    const opening = `${sectionOpen ? '</section>' : ''}<section class="paper-section" id="${id}"><h2>${escape(heading)}</h2>`;
    sectionOpen = true;
    return opening;
  }
  if (/^### /.test(block)) return `<h3>${escape(lines[0].slice(4).trim())}</h3>`;
  if (lines[0].startsWith('|')) {
    const rows = lines.filter(line => !/^\|\s*-/.test(line)).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
    return `<div class="table-wrap"><table><thead><tr>${rows[0].map(cell => `<th scope="col">${inline(cell)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map(row => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${inline(cell)}</th>` : `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  if (/^`[^`]+`$/.test(block.trim())) return `<div class="equation">${inline(block.trim())}</div>`;
  if (inReferences && /^\d+\. /.test(block)) {
    return `<ol class="references-list">${lines.filter(line => /^\d+\. /.test(line)).map(line => {
      const id = line.match(/^\d+/)[0];
      const text = line.replace(/^\d+\. /, '');
      const url = text.match(/https:\/\/\S+/)?.[0];
      if (!url) throw new Error(`Reference ${id} lacks a source URL`);
      return `<li id="ref-${id}"><span class="ref-number">[${id}]</span><div>${inline(text.replace(url, '').trim())}<a class="source-link" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a></div></li>`;
    }).join('')}</ol>`;
  }
  return `<p>${inline(lines.join(' ').trim())}</p>`;
}).join('\n') + (sectionOpen ? '</section>' : '');
const url = 'https://kaorimd.site/research/kaori';
const description = 'A technical research article on Kaori’s IMD receipts, approval checks, official staking, network tools and the proposed Kaori Fuel reimbursement model.';
const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#101421">
<title>${escape(title)} | Kaori Research</title>
<meta name="description" content="${escape(description)}"><meta name="author" content="Kaori IMD Project">
<link rel="canonical" href="${url}"><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/research/kaori-article.css">
<meta property="og:type" content="article"><meta property="og:site_name" content="Kaori IMD"><meta property="og:title" content="Kaori IMD: Practical tools and the Kaori Fuel proposal"><meta property="og:description" content="${escape(description)}"><meta property="og:url" content="${url}"><meta property="og:image" content="https://kaorimd.site/brand/kaori-banner.png"><meta property="og:image:alt" content="Kaori IMD pixel manga artwork"><meta property="article:published_time" content="2026-10-05"><meta property="article:author" content="Kaori IMD Project">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:site" content="@KaoriIMD"><meta name="twitter:title" content="Kaori IMD: Practical tools and the Kaori Fuel proposal"><meta name="twitter:description" content="${escape(description)}"><meta name="twitter:image" content="https://kaorimd.site/brand/kaori-banner.png"><meta name="twitter:image:alt" content="Kaori IMD pixel manga artwork">
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'TechArticle', headline: title, description, datePublished: '2026-10-05', inLanguage: 'en', author: { '@type': 'Organization', name: 'Kaori IMD Project' }, publisher: { '@type': 'Organization', name: 'Kaori IMD' }, mainEntityOfPage: url, image: 'https://kaorimd.site/brand/kaori-banner.png' }).replaceAll('<', '\\u003c')}</script>
</head><body>
<a class="skip-link" href="#paper">Skip to article</a>
<header class="research-header"><a class="research-brand" href="/#home"><img src="/brand/kaori-avatar.png" width="44" height="44" alt=""><span>KAORI <em>IMD</em><small>RESEARCH / 001</small></span></a><nav aria-label="Research navigation"><a href="/#home">Back to workspace ↗</a><a href="/research/Kaori-IMD-Research.pdf" download>Download PDF ↓</a><a href="https://x.com/KaoriIMD" target="_blank" rel="noopener noreferrer">Follow on X ↗</a></nav></header>
<div class="paper-layout"><aside class="paper-toc"><p>IN THIS PAPER</p><nav aria-label="Article contents">${contents.map(({ id, heading }) => `<a href="#${id}">${escape(heading)}</a>`).join('')}</nav><a class="policy-link" href="/research/kaori-fuel-policy.txt">Read the Fuel policy ↗</a></aside>
<main id="paper" class="paper"><article>
<div class="paper-label"><span>TECHNICAL RESEARCH ARTICLE</span><span>EN / VERSION 1.0</span></div>
<header class="paper-hero"><h1>${escape(title)}</h1><p class="paper-subtitle">${escape(subtitle)}</p><div class="paper-meta"><span>Kaori IMD Project</span><time datetime="2026-10-05">5 October 2026</time></div><p class="publication-note">Project-authored research. Not peer reviewed. This paper describes available Kaori tools and the proposed Kaori Fuel design.</p><p class="paper-keywords"><strong>Keywords</strong> IMD · Ethereum · receipts · permissions · staking · agent observability · reimbursement</p></header>
<div class="paper-intro"><span aria-hidden="true">01</span><p>Practical solutions for IMD begin with readable evidence, clear wallet permissions and a cost model that respects its funding.</p></div>
${html}
<nav class="paper-tools" aria-label="Open a Kaori utility"><a href="/#receipt">Read a receipt ↗</a><a href="/#approvals">Check an approval ↗</a><a href="/#staking">Open staking ↗</a><a href="/#network">Explore the network ↗</a></nav>
</article></main></div>
<footer class="research-footer"><span>KAORI IMD / RESEARCH</span><a href="/#home">Every transfer has a story. ↗</a></footer>
</body></html>`;
const out = resolve(root, 'public/research');
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'kaori.html'), page);
await writeFile(resolve(out, 'kaori-fuel-policy.txt'), policy);
console.log(`Kaori research article generated: ${contents.length} sections, ${source.split(/\s+/).length} source words.`);
