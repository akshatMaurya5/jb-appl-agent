#!/usr/bin/env node

/**
 * generate-dashboard.mjs — Interactive Browser Application Tracker Dashboard
 * 
 * Reads data/applications.md, enriches with pipeline/verified batch data,
 * and generates a modern, self-contained, interactive HTML dashboard
 * featuring a collapsible sidebar with date navigation, collapsible date accordions,
 * company grouping, and full search & filtering capabilities.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCareerOpsRoot, resolveTrackerPath } from './path-resolver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = getCareerOpsRoot();
const trackerPath = resolveTrackerPath(root);

console.log(`[dashboard] Reading tracker from: ${trackerPath}`);

if (!fs.existsSync(trackerPath)) {
  console.error(`[error] Tracker file not found: ${trackerPath}`);
  process.exit(1);
}

// 1. Load enrichment data
let verifiedBatch = [];
const verifiedPath = path.join(root, 'data', 'verified-batch-20-results.json');
if (fs.existsSync(verifiedPath)) {
  try {
    verifiedBatch = JSON.parse(fs.readFileSync(verifiedPath, 'utf8'));
  } catch (err) {
    console.warn(`[warn] Could not parse verified-batch-20-results.json: ${err.message}`);
  }
}

const verifiedMap = new Map();
for (const item of verifiedBatch) {
  if (item.url) verifiedMap.set(item.url.trim(), item);
}

const pipelineMap = new Map();
const pipelinePath = path.join(root, 'data', 'pipeline.md');
if (fs.existsSync(pipelinePath)) {
  try {
    const pipelineContent = fs.readFileSync(pipelinePath, 'utf8');
    for (const line of pipelineContent.split('\n')) {
      const match = line.match(/- \[[ x]\]\s+(https?:\/\/[^\s—]+)\s+—\s+([^(\n]+)(?:\(([^)\n]+)\))?/);
      if (match) {
        pipelineMap.set(match[1].trim(), {
          company: match[2].trim(),
          details: (match[3] || '').trim(),
        });
      }
    }
  } catch (err) {
    console.warn(`[warn] Could not parse pipeline.md: ${err.message}`);
  }
}

// 2. Parse applications.md
const trackerContent = fs.readFileSync(trackerPath, 'utf8');
const lines = trackerContent.split('\n');
const applications = [];

for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || trimmed.includes('|---|') || trimmed.includes('| # |')) continue;
  const parts = trimmed.split('|').map(p => p.trim());
  
  // Format: | # | Date | Company | Role | Score | Status | PDF | Report | Notes | URL |
  if (parts.length >= 10 && /^\d+$/.test(parts[1])) {
    const id = parseInt(parts[1], 10);
    const date = parts[2];
    const company = parts[3];
    const role = parts[4];
    const score = parts[5];
    const status = parts[6] || 'Evaluated';
    const pdfRaw = parts[7] || '';
    const reportRaw = parts[8] || '';
    const notes = parts[9] || '';
    const urlRaw = parts[10] || '';

    // Extract URL
    let url = '';
    const urlMatch = urlRaw.match(/https?:\/\/[^\s)\]]+/);
    if (urlMatch) {
      url = urlMatch[0];
    } else {
      const notesMatch = notes.match(/https?:\/\/[^\s)\]]+/);
      if (notesMatch) url = notesMatch[0];
    }

    // Extract Report link
    let reportLink = '';
    const reportMatch = reportRaw.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (reportMatch) {
      reportLink = reportMatch[2];
    }

    // Extract PDF link
    let pdfLink = '';
    const pdfMatch = pdfRaw.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (pdfMatch) {
      pdfLink = pdfMatch[2];
    }

    // Derive Location
    let location = '';
    if (url && verifiedMap.has(url)) {
      location = verifiedMap.get(url).location || '';
    } else if (url && pipelineMap.has(url)) {
      const p = pipelineMap.get(url);
      const sub = p.details.split(';')[0].split(',');
      if (sub.length > 1) location = sub.slice(1).join(', ').trim();
      else if (sub.length === 1 && !sub[0].toLowerCase().includes('submitted')) location = sub[0].trim();
    }
    if (!location && notes) {
      const parts = notes.split('·').map(s => s.trim());
      if (parts.length > 1 && !parts[0].toLowerCase().includes('submitted')) {
        location = parts[0];
      }
    }

    applications.push({
      id,
      date,
      company,
      role,
      score: score === 'N/A' ? '' : score,
      status,
      location: location || 'Location unlisted / Worldwide',
      url,
      reportLink,
      pdfLink,
      notes,
    });
  }
}

// 3. Aggregate metrics & daily groupings
const totalCount = applications.length;
const appliedCount = applications.filter(a => a.status.toLowerCase() === 'applied').length;
const evaluatedCount = applications.filter(a => a.status.toLowerCase() === 'evaluated').length;
const otherCount = totalCount - appliedCount - evaluatedCount;

const uniqueCompanies = new Set(applications.map(a => a.company.toLowerCase())).size;

// Group by Date (descending)
const dateGroupsMap = new Map();
for (const app of applications) {
  if (!dateGroupsMap.has(app.date)) {
    dateGroupsMap.set(app.date, []);
  }
  dateGroupsMap.get(app.date).push(app);
}

// Sort dates descending
const sortedDates = [...dateGroupsMap.keys()].sort((a, b) => b.localeCompare(a));

const dailyStats = sortedDates.map(date => {
  const apps = dateGroupsMap.get(date);
  const applied = apps.filter(a => a.status.toLowerCase() === 'applied').length;
  const evaluated = apps.filter(a => a.status.toLowerCase() === 'evaluated').length;

  // Group by company
  const companyMap = new Map();
  for (const app of apps) {
    if (!companyMap.has(app.company)) {
      companyMap.set(app.company, []);
    }
    companyMap.get(app.company).push(app);
  }

  // Sort companies by role count desc, then name asc
  const companies = [...companyMap.entries()]
    .map(([company, roles]) => ({
      company,
      roleCount: roles.length,
      appliedCount: roles.filter(r => r.status.toLowerCase() === 'applied').length,
      roles,
    }))
    .sort((a, b) => b.roleCount - a.roleCount || a.company.localeCompare(b.company));

  return {
    date,
    total: apps.length,
    applied,
    evaluated,
    companyCount: companies.length,
    companies,
  };
});

// Dynamically resolve candidate name from profile.yml
let candidateName = 'Software Engineer';
let candidateTitle = 'Backend / Software Engineer';
const profileCfgPath = path.join(root, 'config', 'profile.yml');
if (fs.existsSync(profileCfgPath)) {
  try {
    const rawYaml = fs.readFileSync(profileCfgPath, 'utf8');
    const nameMatch = rawYaml.match(/full_name:\s*["']?([^"'\n]+)["']?/);
    const titleMatch = rawYaml.match(/title:\s*["']?([^"'\n]+)["']?/);
    if (nameMatch) candidateName = nameMatch[1].trim();
    if (titleMatch) candidateTitle = titleMatch[1].trim();
  } catch {}
}

// Build raw JSON payload for frontend reactivity
const dataPayload = JSON.stringify({
  generatedAt: new Date().toISOString(),
  candidate: candidateName,
  profileTitle: candidateTitle,
  stats: {
    total: totalCount,
    applied: appliedCount,
    evaluated: evaluatedCount,
    other: otherCount,
    uniqueCompanies,
  },
  dailyStats,
  applications,
});

// 4. Generate HTML with Collapsible Sidebar and Collapsible Date Sections
const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Career-Ops Application Tracker Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #09090b;
      --card-bg: #141417;
      --card-border: #27272a;
      --card-hover: #1c1c21;
      --text-main: #f4f4f5;
      --text-muted: #a1a1aa;
      --text-faint: #71717a;
      --primary: #3b82f6;
      --primary-glow: rgba(59, 130, 246, 0.2);
      --success: #10b981;
      --success-glow: rgba(16, 185, 129, 0.2);
      --warning: #f59e0b;
      --accent: #8b5cf6;
      --header-bg: rgba(9, 9, 11, 0.85);
      --sidebar-width: 300px;
    }
    html.light {
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --card-border: #e2e8f0;
      --card-hover: #f1f5f9;
      --text-main: #0f172a;
      --text-muted: #475569;
      --text-faint: #94a3b8;
      --primary: #2563eb;
      --primary-glow: rgba(37, 99, 235, 0.15);
      --success: #059669;
      --success-glow: rgba(5, 150, 105, 0.15);
      --warning: #d97706;
      --accent: #7c3aed;
      --header-bg: rgba(248, 250, 252, 0.85);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      min-height: 100vh;
      line-height: 1.5;
      transition: background-color 0.2s ease, color 0.2s ease;
      padding-bottom: 80px;
    }
    code, .font-mono { font-family: 'JetBrains Mono', monospace; }
    a { color: inherit; text-decoration: none; }
    
    /* Layout */
    .container { max-width: 1480px; margin: 0 auto; padding: 0 24px; }
    
    /* Header */
    header {
      position: sticky;
      top: 0;
      z-index: 50;
      background: var(--header-bg);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--card-border);
      padding: 14px 0;
    }
    .header-inner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
      color: #fff;
      box-shadow: 0 4px 14px var(--success-glow);
    }
    .brand-title {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .brand-subtitle {
      font-size: 12px;
      color: var(--text-muted);
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 7px 13px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      color: var(--text-main);
      transition: all 0.15s ease;
      user-select: none;
    }
    .btn:hover {
      background: var(--card-hover);
      border-color: var(--text-faint);
    }
    .btn-primary {
      background: #10b981;
      border-color: #10b981;
      color: #fff;
    }
    .btn-primary:hover {
      background: #059669;
      border-color: #059669;
    }

    /* KPI Stats Bar */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 14px;
      margin: 22px 0;
    }
    .kpi-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
    }
    .kpi-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px -4px rgba(0,0,0,0.25);
    }
    .kpi-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .kpi-val {
      font-size: 32px;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
      margin-bottom: 4px;
    }
    .kpi-desc {
      font-size: 12px;
      color: var(--text-faint);
    }
    .kpi-applied { color: var(--success); }
    .kpi-applied-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, #10b981, #059669);
    }
    .kpi-evaluated { color: var(--primary); }
    .kpi-evaluated-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
    }

    /* Main Dashboard Layout with Collapsible Sidebar */
    .dashboard-layout {
      display: flex;
      gap: 24px;
      align-items: flex-start;
      position: relative;
      transition: all 0.25s ease;
    }

    /* Sidebar */
    .sidebar {
      width: var(--sidebar-width);
      min-width: var(--sidebar-width);
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 16px;
      position: sticky;
      top: 86px;
      max-height: calc(100vh - 110px);
      overflow-y: auto;
      transition: width 0.25s ease, min-width 0.25s ease, opacity 0.25s ease, transform 0.25s ease;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .sidebar.collapsed {
      width: 0;
      min-width: 0;
      padding: 0;
      border: none;
      opacity: 0;
      pointer-events: none;
      transform: translateX(-20px);
      overflow: hidden;
    }
    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--card-border);
    }
    .sidebar-title {
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .sidebar-nav {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sidebar-item {
      padding: 10px 12px;
      border-radius: 8px;
      background: var(--bg);
      border: 1px solid var(--card-border);
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      flex-direction: column;
      gap: 6px;
      text-align: left;
    }
    .sidebar-item:hover {
      background: var(--card-hover);
      border-color: var(--text-faint);
    }
    .sidebar-item.active {
      border-color: var(--primary);
      background: rgba(59, 130, 246, 0.08);
      box-shadow: 0 0 0 1px var(--primary);
    }
    .sidebar-item-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .sidebar-item-date {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-main);
    }
    .sidebar-badges {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .badge-mini {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 10px;
    }
    .badge-applied-mini {
      background: rgba(16, 185, 129, 0.18);
      color: #34d399;
    }
    .badge-total-mini {
      background: var(--card-border);
      color: var(--text-muted);
    }
    .sidebar-item-companies {
      font-size: 11px;
      color: var(--text-faint);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Content Area */
    .content-area {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    /* Controls Bar */
    .controls-panel {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 14px 18px;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      margin-bottom: 22px;
    }
    .search-box {
      flex: 1;
      min-width: 240px;
      position: relative;
    }
    .search-input {
      width: 100%;
      background: var(--bg);
      border: 1px solid var(--card-border);
      color: var(--text-main);
      padding: 9px 12px 9px 36px;
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s ease;
    }
    .search-input:focus {
      border-color: var(--primary);
    }
    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-faint);
      pointer-events: none;
    }
    .filter-tabs {
      display: flex;
      gap: 4px;
      background: var(--bg);
      padding: 3px;
      border-radius: 8px;
      border: 1px solid var(--card-border);
    }
    .tab-btn {
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .tab-btn.active {
      background: var(--card-bg);
      color: var(--text-main);
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }
    .view-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* Collapsible Day Section */
    .day-section {
      margin-bottom: 24px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      overflow: hidden;
      transition: all 0.2s ease;
    }
    .day-header-accordion {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      cursor: pointer;
      user-select: none;
      background: var(--card-bg);
      transition: background-color 0.15s ease;
      border-bottom: 1px solid transparent;
    }
    .day-header-accordion:hover {
      background: var(--card-hover);
    }
    .day-section.expanded .day-header-accordion {
      border-bottom-color: var(--card-border);
    }
    .day-title-wrap {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .day-chevron {
      font-size: 14px;
      color: var(--text-faint);
      transition: transform 0.2s ease;
      display: inline-block;
    }
    .day-section.expanded .day-chevron {
      transform: rotate(90deg);
      color: var(--primary);
    }
    .day-calendar-badge {
      padding: 4px 8px;
      background: var(--bg);
      border: 1px solid var(--card-border);
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
      color: var(--primary);
    }
    .day-title {
      font-size: 17px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .day-pill-group {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .pill {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 9px;
      border-radius: 20px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    .pill-applied {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .pill-evaluated {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
    }
    .pill-neutral {
      background: var(--bg);
      color: var(--text-muted);
      border: 1px solid var(--card-border);
    }

    /* Day Body */
    .day-body {
      padding: 20px;
      display: none;
    }
    .day-section.expanded .day-body {
      display: block;
    }

    /* Company Group Container */
    .companies-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
      gap: 14px;
    }
    @media (max-width: 768px) {
      .companies-grid { grid-template-columns: 1fr; }
    }
    .company-card {
      background: var(--bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: border-color 0.15s ease, transform 0.15s ease;
    }
    .company-card:hover {
      border-color: var(--text-faint);
    }
    .company-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: var(--card-bg);
      cursor: pointer;
      user-select: none;
      border-bottom: 1px solid var(--card-border);
    }
    .company-card-header:hover {
      background: var(--card-hover);
    }
    .company-brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .company-avatar {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: #27272a;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 12px;
      color: var(--text-main);
      border: 1px solid var(--card-border);
    }
    .company-name {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .company-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 10px;
      background: var(--bg);
      border: 1px solid var(--card-border);
      color: var(--text-muted);
    }
    
    /* Roles inside Company Card */
    .role-list {
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .company-card.collapsed .role-list {
      display: none;
    }
    .role-item {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 12px;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .role-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .role-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
      line-height: 1.35;
    }
    .role-meta {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .role-meta-item {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .role-notes {
      font-size: 11px;
      color: var(--text-faint);
      background: var(--bg);
      padding: 5px 8px;
      border-radius: 5px;
      border: 1px solid var(--card-border);
      line-height: 1.4;
      word-break: break-word;
    }
    .role-links {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
    }
    .role-link-btn {
      font-size: 11px;
      font-weight: 600;
      color: var(--primary);
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      border-radius: 4px;
      background: rgba(59, 130, 246, 0.08);
      border: 1px solid rgba(59, 130, 246, 0.2);
      transition: all 0.15s ease;
    }
    .role-link-btn:hover {
      background: rgba(59, 130, 246, 0.2);
      text-decoration: none;
    }

    /* Table View */
    .table-container {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow-x: auto;
      margin-bottom: 30px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    th {
      background: var(--bg);
      padding: 12px 16px;
      font-weight: 600;
      color: var(--text-muted);
      border-bottom: 1px solid var(--card-border);
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
    }
    th:hover { color: var(--text-main); }
    td {
      padding: 12px 16px;
      border-bottom: 1px solid var(--card-border);
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: var(--card-hover); }

    /* Modals & Helpers */
    .empty-state {
      text-align: center;
      padding: 60px 20px;
      color: var(--text-muted);
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
    }
    .empty-state svg {
      width: 44px;
      height: 44px;
      stroke: var(--text-faint);
      margin-bottom: 12px;
    }

    /* Footer */
    footer {
      margin-top: 50px;
      text-align: center;
      font-size: 13px;
      color: var(--text-faint);
    }
  </style>
</head>
<body>

  <!-- Header -->
  <header>
    <div class="container header-inner">
      <div class="brand">
        <div class="brand-icon">⚡</div>
        <div>
          <div class="brand-title">Career-Ops Application Tracker</div>
          <div class="brand-subtitle">Interactive Pipeline Dashboard for <strong style="color:var(--text-main)">${candidateName}</strong></div>
        </div>
      </div>
      <div class="header-actions">
        <button class="btn" id="sidebarToggleBtn" onclick="toggleSidebar()">
          <span id="sidebarToggleIcon">◀</span> <span id="sidebarToggleLabel">Hide Sidebar</span>
        </button>
        <button class="btn" id="themeToggleBtn" onclick="toggleTheme()">
          <span id="themeIcon">☀️</span> <span id="themeLabel">Light</span>
        </button>
        <button class="btn" onclick="exportCSV()">
          <span>📥</span> Export CSV
        </button>
        <button class="btn btn-primary" onclick="window.location.reload()">
          <span>🔄</span> Refresh
        </button>
      </div>
    </div>
  </header>

  <main class="container">

    <!-- KPI Metric Cards -->
    <section class="kpi-grid">
      <div class="kpi-card kpi-applied-card">
        <div class="kpi-label">
          <span>Total Applied</span>
          <span>🚀</span>
        </div>
        <div class="kpi-val kpi-applied" id="kpiApplied">0</div>
        <div class="kpi-desc">Applications confirmed & submitted</div>
      </div>

      <div class="kpi-card kpi-evaluated-card">
        <div class="kpi-label">
          <span>Evaluated / Shortlisted</span>
          <span>📋</span>
        </div>
        <div class="kpi-val kpi-evaluated" id="kpiEvaluated">0</div>
        <div class="kpi-desc">Scored roles awaiting submission</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Total Tracked Roles</span>
          <span>🎯</span>
        </div>
        <div class="kpi-val" id="kpiTotal">0</div>
        <div class="kpi-desc">Lifetime applications recorded</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">
          <span>Unique Companies</span>
          <span>🏢</span>
        </div>
        <div class="kpi-val" id="kpiCompanies">0</div>
        <div class="kpi-desc">Organizations applied or evaluated</div>
      </div>
    </section>

    <!-- Dashboard Layout: Sidebar + Content -->
    <div class="dashboard-layout">

      <!-- Collapsible Sidebar with Dates -->
      <aside class="sidebar" id="dateSidebar">
        <div class="sidebar-header">
          <div class="sidebar-title">
            <span>📅</span> Timeline by Date
          </div>
          <button class="btn" style="padding: 2px 7px; font-size: 11px;" onclick="toggleSidebar()" title="Collapse Sidebar">
            ◀
          </button>
        </div>

        <nav class="sidebar-nav" id="sidebarDateList">
          <!-- Dynamically populated -->
        </nav>
      </aside>

      <!-- Main Content Area -->
      <section class="content-area">

        <!-- Controls & Search -->
        <div class="controls-panel">
          <div class="search-box">
            <span class="search-icon">🔍</span>
            <input 
              type="text" 
              id="searchInput" 
              class="search-input" 
              placeholder="Search company, role title, location, keywords..." 
              oninput="handleSearch()"
            />
          </div>

          <div class="filter-tabs">
            <button class="tab-btn active" data-filter="all" onclick="setStatusFilter('all')">All (<span id="countAll">0</span>)</button>
            <button class="tab-btn" data-filter="applied" onclick="setStatusFilter('applied')">Applied (<span id="countApplied">0</span>)</button>
            <button class="tab-btn" data-filter="evaluated" onclick="setStatusFilter('evaluated')">Evaluated (<span id="countEvaluated">0</span>)</button>
          </div>

          <div class="view-actions">
            <button class="btn" id="toggleExpandAllBtn" onclick="toggleExpandAll()">
              <span>▼</span> <span id="toggleExpandAllLabel">Collapse All</span>
            </button>
            <button class="btn" id="viewDailyBtn" style="border-color:var(--primary); color:var(--primary)" onclick="switchView('daily')">
              <span>📅</span> Grouped
            </button>
            <button class="btn" id="viewTableBtn" onclick="switchView('table')">
              <span>📋</span> Table
            </button>
          </div>
        </div>

        <!-- View 1: Daily Grouped View (Default) -->
        <div id="dailyView">
          <div id="dailySectionsContainer"></div>
        </div>

        <!-- View 2: Table View -->
        <div id="tableView" style="display: none;">
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th onclick="sortTable('id')">#</th>
                  <th onclick="sortTable('date')">Date ⬍</th>
                  <th onclick="sortTable('company')">Company ⬍</th>
                  <th onclick="sortTable('role')">Role ⬍</th>
                  <th>Location</th>
                  <th onclick="sortTable('status')">Status ⬍</th>
                  <th>Score</th>
                  <th>Link</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody id="tableBody"></tbody>
            </table>
          </div>
        </div>

        <div id="emptyState" class="empty-state" style="display: none;">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <h3>No matching applications found</h3>
          <p style="font-size:13px; margin-top:6px;">Try adjusting your keyword filter, selected date, or status filter.</p>
        </div>

      </section>
    </div>

  </main>

  <footer>
    <div class="container">
      Generated automatically from <code class="font-mono">data/applications.md</code> · Last synchronized: <span id="syncTimestamp"></span>
    </div>
  </footer>

  <script>
    // Embedded Data Payload from Career-Ops
    const PAYLOAD = ${dataPayload};

    let selectedDateFilter = 'all'; // 'all' or specific 'YYYY-MM-DD'
    let currentFilter = 'all';       // 'all' | 'applied' | 'evaluated'
    let currentSearch = '';
    let currentView = 'daily';
    let sortColumn = 'id';
    let sortAsc = false;
    let allExpanded = true;

    // Track collapsed date sections & company cards
    const collapsedDates = new Set();
    const collapsedCompanies = new Set();

    // Initialize Dashboard
    function init() {
      // Set KPI values
      document.getElementById('kpiTotal').textContent = PAYLOAD.stats.total;
      document.getElementById('kpiApplied').textContent = PAYLOAD.stats.applied;
      document.getElementById('kpiEvaluated').textContent = PAYLOAD.stats.evaluated;
      document.getElementById('kpiCompanies').textContent = PAYLOAD.stats.uniqueCompanies;

      document.getElementById('countAll').textContent = PAYLOAD.stats.total;
      document.getElementById('countApplied').textContent = PAYLOAD.stats.applied;
      document.getElementById('countEvaluated').textContent = PAYLOAD.stats.evaluated;

      document.getElementById('syncTimestamp').textContent = new Date(PAYLOAD.generatedAt).toLocaleString();

      renderSidebar();
      renderDailyView();
      renderTableView();

      // Detect saved preferences
      const savedTheme = localStorage.getItem('career_ops_theme');
      if (savedTheme === 'light') setTheme('light');
      else setTheme('dark');

      const savedSidebar = localStorage.getItem('career_ops_sidebar');
      if (savedSidebar === 'collapsed') {
        const sidebar = document.getElementById('dateSidebar');
        sidebar.classList.add('collapsed');
        document.getElementById('sidebarToggleIcon').textContent = '▶';
        document.getElementById('sidebarToggleLabel').textContent = 'Show Sidebar';
      }
    }

    // Render Sidebar Date Navigation
    function renderSidebar() {
      const container = document.getElementById('sidebarDateList');
      let html = '';

      // All Dates Item
      const isAllActive = selectedDateFilter === 'all';
      html += \`
        <div class="sidebar-item \${isAllActive ? 'active' : ''}" onclick="selectDateFilter('all')">
          <div class="sidebar-item-top">
            <span class="sidebar-item-date">🌐 All Dates</span>
            <div class="sidebar-badges">
              <span class="badge-mini badge-applied-mini">\${PAYLOAD.stats.applied} Applied</span>
              <span class="badge-mini badge-total-mini">\${PAYLOAD.stats.total} Total</span>
            </div>
          </div>
          <div class="sidebar-item-companies">\${PAYLOAD.dailyStats.length} Days Tracked · \${PAYLOAD.stats.uniqueCompanies} Companies</div>
        </div>
      \`;

      // Per-Date Items
      for (const ds of PAYLOAD.dailyStats) {
        const isActive = selectedDateFilter === ds.date;
        const dObj = new Date(ds.date + 'T00:00:00');
        const formatted = dObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const companySample = ds.companies.map(c => c.company).slice(0, 3).join(', ') + (ds.companies.length > 3 ? '...' : '');

        html += \`
          <div class="sidebar-item \${isActive ? 'active' : ''}" onclick="selectDateFilter('\${ds.date}')">
            <div class="sidebar-item-top">
              <span class="sidebar-item-date">📅 \${formatted}</span>
              <div class="sidebar-badges">
                <span class="badge-mini badge-applied-mini">\${ds.applied} Applied</span>
                <span class="badge-mini badge-total-mini">\${ds.total} Total</span>
              </div>
            </div>
            <div class="sidebar-item-companies">\${ds.companies.length} Co: \${companySample}</div>
          </div>
        \`;
      }

      container.innerHTML = html;
    }

    function selectDateFilter(date) {
      selectedDateFilter = date;
      renderSidebar();
      renderDailyView();
      renderTableView();

      // If specific date selected, ensure it is expanded and scroll into view smoothly
      if (date !== 'all') {
        collapsedDates.delete(date);
        const el = document.getElementById(\`day-section-\${date}\`);
        if (el) {
          el.classList.add('expanded');
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }

    // Filter Logic
    function getFilteredApplications() {
      return PAYLOAD.applications.filter(app => {
        // Date filter from sidebar
        if (selectedDateFilter !== 'all' && app.date !== selectedDateFilter) {
          return false;
        }

        // Status filter
        const matchesStatus = 
          currentFilter === 'all' ? true :
          currentFilter === 'applied' ? app.status.toLowerCase() === 'applied' :
          currentFilter === 'evaluated' ? app.status.toLowerCase() === 'evaluated' : true;

        if (!matchesStatus) return false;

        // Search query
        if (!currentSearch) return true;
        const q = currentSearch.toLowerCase();
        return (
          app.company.toLowerCase().includes(q) ||
          app.role.toLowerCase().includes(q) ||
          app.location.toLowerCase().includes(q) ||
          app.notes.toLowerCase().includes(q) ||
          app.date.includes(q)
        );
      });
    }

    // Render Daily Breakdown (Grouped by Date, then Grouped by Company)
    function renderDailyView() {
      const container = document.getElementById('dailySectionsContainer');
      const filtered = getFilteredApplications();

      if (filtered.length === 0) {
        container.innerHTML = '';
        document.getElementById('emptyState').style.display = 'block';
        return;
      }
      document.getElementById('emptyState').style.display = 'none';

      // Group filtered applications by Date
      const dateMap = new Map();
      for (const app of filtered) {
        if (!dateMap.has(app.date)) dateMap.set(app.date, []);
        dateMap.get(app.date).push(app);
      }

      const sortedDates = [...dateMap.keys()].sort((a, b) => b.localeCompare(a));
      let html = '';

      for (const date of sortedDates) {
        const appsOnDate = dateMap.get(date);
        const appliedOnDate = appsOnDate.filter(a => a.status.toLowerCase() === 'applied').length;
        const evaluatedOnDate = appsOnDate.filter(a => a.status.toLowerCase() === 'evaluated').length;

        // Group by company
        const companyMap = new Map();
        for (const app of appsOnDate) {
          if (!companyMap.has(app.company)) companyMap.set(app.company, []);
          companyMap.get(app.company).push(app);
        }

        const sortedCompanies = [...companyMap.entries()]
          .map(([company, roles]) => ({ company, roles }))
          .sort((a, b) => b.roles.length - a.roles.length || a.company.localeCompare(b.company));

        // Format friendly date
        const dateObj = new Date(date + 'T00:00:00');
        const formattedDate = dateObj.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });

        const isCollapsed = collapsedDates.has(date);

        html += \`
          <section class="day-section \${!isCollapsed ? 'expanded' : ''}" id="day-section-\${date}">
            <div class="day-header-accordion" onclick="toggleDateSection('\${date}')">
              <div class="day-title-wrap">
                <span class="day-chevron">▶</span>
                <span class="day-calendar-badge">\${date}</span>
                <h2 class="day-title">\${formattedDate}</h2>
              </div>
              <div class="day-pill-group">
                <span class="pill pill-applied">✓ \${appliedOnDate} Applied</span>
                \${evaluatedOnDate > 0 ? \`<span class="pill pill-evaluated">📋 \${evaluatedOnDate} Evaluated</span>\` : ''}
                <span class="pill pill-neutral">\${appsOnDate.length} Total</span>
                <span class="pill pill-neutral">🏢 \${sortedCompanies.length} Companies</span>
              </div>
            </div>

            <div class="day-body">
              <div class="companies-grid">
        \`;

        for (const item of sortedCompanies) {
          const compName = item.company;
          const initial = compName.charAt(0).toUpperCase();
          const roles = item.roles;
          const companyKey = \`\${date}-\${compName}\`;
          const isCompCollapsed = collapsedCompanies.has(companyKey);

          html += \`
            <div class="company-card \${isCompCollapsed ? 'collapsed' : ''}" id="comp-card-\${companyKey}">
              <div class="company-card-header" onclick="toggleCompanyCard('\${companyKey}')">
                <div class="company-brand">
                  <div class="company-avatar">\${initial}</div>
                  <div class="company-name">\${compName}</div>
                </div>
                <div class="company-badge">\${roles.length} \${roles.length === 1 ? 'Role' : 'Roles'} ▾</div>
              </div>

              <div class="role-list">
          \`;

          for (const role of roles) {
            const isApplied = role.status.toLowerCase() === 'applied';
            const statusClass = isApplied ? 'pill-applied' : 'pill-evaluated';
            const statusIcon = isApplied ? '✓' : '📋';

            html += \`
              <div class="role-item">
                <div class="role-top">
                  <div class="role-title">#\${role.id} \${role.role}</div>
                  <span class="pill \${statusClass}">\${statusIcon} \${role.status}</span>
                </div>

                <div class="role-meta">
                  <span class="role-meta-item">📍 \${role.location}</span>
                  \${role.score ? \`<span class="role-meta-item">⭐ \${role.score}</span>\` : ''}
                </div>

                \${role.notes ? \`<div class="role-notes">💬 \${role.notes}</div>\` : ''}

                <div class="role-links">
                  \${role.url ? \`<a href="\${role.url}" target="_blank" class="role-link-btn">🔗 Open Listing ↗</a>\` : '<span style="font-size:11px; color:var(--text-faint)">No direct link</span>'}
                  \${role.reportLink ? \`<a href="\${role.reportLink}" target="_blank" class="role-link-btn">📄 Report</a>\` : ''}
                  \${role.pdfLink ? \`<a href="\${role.pdfLink}" target="_blank" class="role-link-btn">📎 PDF</a>\` : ''}
                </div>
              </div>
            \`;
          }

          html += \`
              </div>
            </div>
          \`;
        }

        html += \`
              </div>
            </div>
          </section>
        \`;
      }

      container.innerHTML = html;
    }

    // Toggle Collapsible Date Section
    function toggleDateSection(date) {
      if (collapsedDates.has(date)) {
        collapsedDates.delete(date);
      } else {
        collapsedDates.add(date);
      }
      const el = document.getElementById(\`day-section-\${date}\`);
      if (el) {
        el.classList.toggle('expanded', !collapsedDates.has(date));
      }
    }

    // Toggle Collapsible Company Card
    function toggleCompanyCard(companyKey) {
      if (collapsedCompanies.has(companyKey)) {
        collapsedCompanies.delete(companyKey);
      } else {
        collapsedCompanies.add(companyKey);
      }
      const el = document.getElementById(\`comp-card-\${companyKey}\`);
      if (el) {
        el.classList.toggle('collapsed', collapsedCompanies.has(companyKey));
      }
    }

    // Toggle Expand / Collapse All
    function toggleExpandAll() {
      allExpanded = !allExpanded;
      const label = document.getElementById('toggleExpandAllLabel');
      label.textContent = allExpanded ? 'Collapse All' : 'Expand All';

      if (allExpanded) {
        collapsedDates.clear();
        collapsedCompanies.clear();
      } else {
        for (const ds of PAYLOAD.dailyStats) {
          collapsedDates.add(ds.date);
          for (const comp of ds.companies) {
            collapsedCompanies.add(\`\${ds.date}-\${comp.company}\`);
          }
        }
      }
      renderDailyView();
    }

    // Sidebar Toggle
    function toggleSidebar() {
      const sidebar = document.getElementById('dateSidebar');
      const icon = document.getElementById('sidebarToggleIcon');
      const label = document.getElementById('sidebarToggleLabel');

      sidebar.classList.toggle('collapsed');
      const isCollapsed = sidebar.classList.contains('collapsed');

      if (isCollapsed) {
        icon.textContent = '▶';
        label.textContent = 'Show Sidebar';
        localStorage.setItem('career_ops_sidebar', 'collapsed');
      } else {
        icon.textContent = '◀';
        label.textContent = 'Hide Sidebar';
        localStorage.setItem('career_ops_sidebar', 'open');
      }
    }

    // Render Table View
    function renderTableView() {
      const tbody = document.getElementById('tableBody');
      let filtered = getFilteredApplications();

      // Sort
      filtered.sort((a, b) => {
        let valA = a[sortColumn];
        let valB = b[sortColumn];
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        if (valA < valB) return sortAsc ? -1 : 1;
        if (valA > valB) return sortAsc ? 1 : -1;
        return 0;
      });

      if (filtered.length === 0) {
        tbody.innerHTML = '';
        return;
      }

      let html = '';
      for (const row of filtered) {
        const isApplied = row.status.toLowerCase() === 'applied';
        const statusClass = isApplied ? 'pill-applied' : 'pill-evaluated';

        html += \`
          <tr>
            <td class="font-mono" style="font-weight:700">#\${row.id}</td>
            <td class="font-mono">\${row.date}</td>
            <td><strong>\${row.company}</strong></td>
            <td>\${row.role}</td>
            <td style="color:var(--text-muted); font-size:12px;">\${row.location}</td>
            <td><span class="pill \${statusClass}">\${row.status}</span></td>
            <td>\${row.score ? \`<span class="pill pill-neutral">⭐ \${row.score}</span>\` : '—'}</td>
            <td>
              \${row.url ? \`<a href="\${row.url}" target="_blank" class="role-link-btn">Open ↗</a>\` : '—'}
            </td>
            <td style="font-size:12px; color:var(--text-muted); max-width: 320px;">\${row.notes}</td>
          </tr>
        \`;
      }
      tbody.innerHTML = html;
    }

    // Controls Handlers
    function setStatusFilter(status) {
      currentFilter = status;
      document.querySelectorAll('.filter-tabs .tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-filter') === status);
      });
      renderDailyView();
      renderTableView();
    }

    function handleSearch() {
      currentSearch = document.getElementById('searchInput').value.trim();
      renderDailyView();
      renderTableView();
    }

    function switchView(mode) {
      currentView = mode;
      const dailyView = document.getElementById('dailyView');
      const tableView = document.getElementById('tableView');
      const dailyBtn = document.getElementById('viewDailyBtn');
      const tableBtn = document.getElementById('viewTableBtn');

      if (mode === 'daily') {
        dailyView.style.display = 'block';
        tableView.style.display = 'none';
        dailyBtn.style.borderColor = 'var(--primary)';
        dailyBtn.style.color = 'var(--primary)';
        tableBtn.style.borderColor = 'var(--card-border)';
        tableBtn.style.color = 'var(--text-main)';
      } else {
        dailyView.style.display = 'none';
        tableView.style.display = 'block';
        tableBtn.style.borderColor = 'var(--primary)';
        tableBtn.style.color = 'var(--primary)';
        dailyBtn.style.borderColor = 'var(--card-border)';
        dailyBtn.style.color = 'var(--text-main)';
      }
    }

    function sortTable(column) {
      if (sortColumn === column) {
        sortAsc = !sortAsc;
      } else {
        sortColumn = column;
        sortAsc = true;
      }
      renderTableView();
    }

    // Theme Toggle
    function setTheme(theme) {
      const html = document.documentElement;
      const themeIcon = document.getElementById('themeIcon');
      const themeLabel = document.getElementById('themeLabel');

      if (theme === 'light') {
        html.classList.remove('dark');
        html.classList.add('light');
        themeIcon.textContent = '🌙';
        themeLabel.textContent = 'Dark';
        localStorage.setItem('career_ops_theme', 'light');
      } else {
        html.classList.remove('light');
        html.classList.add('dark');
        themeIcon.textContent = '☀️';
        themeLabel.textContent = 'Light';
        localStorage.setItem('career_ops_theme', 'dark');
      }
    }

    function toggleTheme() {
      const isLight = document.documentElement.classList.contains('light');
      setTheme(isLight ? 'dark' : 'light');
    }

    // Export CSV
    function exportCSV() {
      const rows = [
        ['ID', 'Date', 'Company', 'Role', 'Status', 'Location', 'Score', 'URL', 'Notes']
      ];
      for (const app of PAYLOAD.applications) {
        rows.push([
          app.id,
          app.date,
          \`"\${(app.company || '').replace(/"/g, '""')}"\`,
          \`"\${(app.role || '').replace(/"/g, '""')}"\`,
          app.status,
          \`"\${(app.location || '').replace(/"/g, '""')}"\`,
          app.score || '',
          app.url || '',
          \`"\${(app.notes || '').replace(/"/g, '""')}"\`
        ]);
      }
      const csvContent = 'data:text/csv;charset=utf-8,' + rows.map(e => e.join(',')).join('\\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', \`career-ops-applications-\${new Date().toISOString().slice(0, 10)}.csv\`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }

    // Start
    window.addEventListener('DOMContentLoaded', init);
  </script>
</body>
</html>
`;

// Write to tracker-dashboard.html in repo root
const outputPath = path.join(root, 'tracker-dashboard.html');
fs.writeFileSync(outputPath, html, 'utf8');

console.log(`[dashboard] Interactive dashboard generated successfully!`);
console.log(`[dashboard] Output: ${outputPath}`);
console.log(`[dashboard] Applications: ${totalCount} (${appliedCount} Applied, ${evaluatedCount} Evaluated)`);
console.log(`[dashboard] Grouped Dates: ${dailyStats.length} days with collapsible sidebar & accordions`);
