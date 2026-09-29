// Invoked via `node` (never as an executable) — see the note in
// scripts/seo-monitor.mjs: a shebang line breaks Vitest's SSR transform.
/**
 * File a GitHub issue when the SEO monitor report alerts.
 *
 * Reads a report JSON produced by scripts/seo-monitor.mjs and, when
 * report.summary.alert (or report.error) is set, opens a `seo-monitor`
 * labeled issue — or comments on the already-open one so repeated daily
 * failures never spam the tracker. When a previously open alert clears, the
 * issue is closed with a recovery note.
 *
 * Uses the `gh` CLI (preinstalled on GitHub runners) with GITHUB_TOKEN. No
 * shell interpolation: args are passed as an array and issue bodies go
 * through --body-file, so report content can never break out of the command.
 *
 * Usage: node scripts/file-seo-alert.mjs <report.json>
 * Env:   GH_TOKEN, GITHUB_REPOSITORY (owner/repo), GITHUB_RUN_ID (optional)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALERT_LABEL = 'seo-monitor';

function runUrl(repo, runId) {
  if (repo && runId) return `[Workflow run](https://github.com/${repo}/actions/runs/${runId})`;
  return '';
}

/**
 * Build the issue title/body for a report, or null when no alert is needed.
 * Pure — no gh calls — so it is unit-testable.
 */
export function buildIssueContent(report, { repo = process.env.GITHUB_REPOSITORY, runId = process.env.GITHUB_RUN_ID } = {}) {
  if (report && report.error) {
    return {
      title: '[Luxedge] SEO monitor run failed',
      body: [
        '## SEO monitor run failed',
        '',
        `The read-only SEO monitor could not complete${report.generated_at ? ` at **${report.generated_at}**` : ''}.`,
        '',
        '```',
        String(report.error).slice(0, 500),
        '```',
        '',
        runUrl(repo, runId),
        '',
        '_Automated by the daily SEO monitor GitHub Action._',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }
  if (!report?.summary?.alert) return null;
  const failed = (report.pages || []).filter((p) => p.state === 'fail');
  const lines = [
    `## SEO monitor alert${report.generated_at ? ` — ${report.generated_at}` : ''}`,
    '',
    `Read-only daily monitor for **${report.site || '?'}** found problems.`,
    '',
    '### Summary',
    `- Sitemap (\`${report.sitemap?.url || '?'}\`): \`${report.sitemap?.state || 'unknown'}\`${report.sitemap?.issues?.length ? ` — ${report.sitemap.issues.join(', ')}` : ''}`,
  ];
  if (report.sitemap_mode) lines.push(`- Sitemap mode: **${report.sitemap_mode}**`);
  if (report.sitemap?.mode === 'degraded-emergency') {
    lines.push(
      '',
      '**DEGRADED-EMERGENCY, not a total outage:** the site serves a valid minimal static sitemap while the database is unavailable. Product/category/blog URLs are deliberately withheld until the live DB-backed feed recovers — this issue stays open until `HEALTHY-DYNAMIC` mode is verified.',
    );
  }
  if (report.sitemap?.body_excerpt) lines.push('', `Sitemap response excerpt: \`${String(report.sitemap.body_excerpt).slice(0, 160)}\``);
  lines.push(
    `- robots.txt: \`${report.robots?.state || 'unknown'}\`${report.robots?.issues?.length ? ` — ${report.robots.issues.join(', ')}` : ''}`,
    `- Pages checked: ${report.summary.checked_urls ?? 0}, failed: ${report.summary.failed_urls ?? 0}`,
  );
  if (failed.length) {
    lines.push('', `### Failed URLs (${failed.length})`);
    for (const page of failed.slice(0, 20)) {
      lines.push(`- \`${page.url}\` → ${(page.issues || []).join(', ')}`);
    }
    if (failed.length > 20) lines.push(`- …and ${failed.length - 20} more`);
  }
  lines.push('', runUrl(repo, runId), '', '_Automated by the daily SEO monitor GitHub Action. Read-only: public GET requests only._');
  return { title: `[Luxedge] SEO monitor failure — ${(report.generated_at || '').slice(0, 10) || 'alert'}`, body: lines.filter(Boolean).join('\n') };
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function tmpBodyFile(text) {
  const dir = mkdtempSync(join(tmpdir(), 'seo-alert-'));
  const file = join(dir, 'body.md');
  writeFileSync(file, text, 'utf8');
  return file;
}

function openAlertIssueNumber(repo) {
  const out = gh(['issue', 'list', '--repo', repo, '--label', ALERT_LABEL, '--state', 'open', '--json', 'number', '--limit', '1']);
  const rows = JSON.parse(out || '[]');
  return Array.isArray(rows) && rows.length ? Number(rows[0].number) : null;
}

/** Read the report, then create/comment/close the alert issue accordingly. */
export function fileAlertIfNeeded(reportPath, { repo = process.env.GITHUB_REPOSITORY, runId = process.env.GITHUB_RUN_ID } = {}) {
  if (!repo) throw new Error('GITHUB_REPOSITORY is not set');
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const content = buildIssueContent(report, { repo, runId });
  const number = openAlertIssueNumber(repo);

  if (!content) {
    if (number !== null) {
      const body = `No alert at ${new Date().toISOString()} — the site is healthy again. Closing this issue.\n\n_Automated by the daily SEO monitor GitHub Action._`;
      gh(['issue', 'comment', String(number), '--repo', repo, '--body-file', tmpBodyFile(body)]);
      gh(['issue', 'close', String(number), '--repo', repo]);
      console.log(`seo-alert: no alert; closed resolved issue #${number}`);
    } else {
      console.log('seo-alert: no alert; nothing to file');
    }
    return;
  }

  const bodyFile = tmpBodyFile(content.body);
  if (number !== null) {
    gh(['issue', 'comment', String(number), '--repo', repo, '--body-file', bodyFile]);
    console.log(`seo-alert: alert; commented on open issue #${number}`);
  } else {
    const created = gh(['issue', 'create', '--repo', repo, '--label', ALERT_LABEL, '--title', content.title, '--body-file', bodyFile]);
    console.log(`seo-alert: alert; created ${created.trim()}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error('usage: node scripts/file-seo-alert.mjs <report.json>');
    process.exitCode = 2;
  } else {
    try {
      fileAlertIfNeeded(reportPath);
    } catch (error) {
      console.error(`seo-alert: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  }
}