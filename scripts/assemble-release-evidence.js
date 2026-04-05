#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (!arg.startsWith('--')) continue;

        const eq = arg.indexOf('=');
        if (eq > -1) {
            out[arg.slice(2, eq)] = arg.slice(eq + 1);
            continue;
        }

        const key = arg.slice(2);
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
            out[key] = true;
            continue;
        }

        out[key] = next;
        i += 1;
    }
    return out;
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonIfExists(filePath) {
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return null;
    }
}

function toWorkspaceRelative(absolutePath) {
    return path.relative(process.cwd(), absolutePath).split(path.sep).join('/');
}

function replaceRcTokens(value, rcId) {
    if (typeof value === 'string') {
        return value.replaceAll('<RC_ID>', rcId);
    }
    if (Array.isArray(value)) {
        return value.map((item) => replaceRcTokens(item, rcId));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            out[k] = replaceRcTokens(v, rcId);
        }
        return out;
    }
    return value;
}

function putArtifact(artifacts, nextArtifact) {
    const idx = artifacts.findIndex((x) => x && x.name === nextArtifact.name);
    if (idx === -1) {
        artifacts.push(nextArtifact);
        return;
    }
    artifacts[idx] = { ...artifacts[idx], ...nextArtifact };
}

function normalizeEvidenceStatus(currentStatus, placeholderStatus, exists) {
    if (!exists) return 'MISSING';
    const normalized = String(currentStatus || '').trim();
    if (!normalized) return 'PENDING_REVIEW';
    if (normalized === placeholderStatus) return 'PENDING_REVIEW';
    if (normalized === 'MISSING') return 'PENDING_REVIEW';
    return normalized;
}

function upsertManifest(manifestPath, templatePath, rcId, evidenceState) {
    const targetDir = `docs/release-candidates/${rcId}`;
    const existing = readJsonIfExists(manifestPath);
    const template = readJsonIfExists(templatePath);

    if (!template) {
        throw new Error(`Template inválido o no legible: ${templatePath}`);
    }

    const seeded = replaceRcTokens(template, rcId);
    const manifest = {
        ...seeded,
        ...(existing && typeof existing === 'object' ? existing : {}),
    };

    manifest.rcId = rcId;
    manifest.generatedAt = new Date().toISOString();

    manifest.preflight = {
        ...(manifest.preflight || {}),
        status: normalizeEvidenceStatus(manifest.preflight?.status, 'PASS|WARN|FAIL', evidenceState.preflight.exists),
        reportPath: `${targetDir}/preflight-report.json`,
        logPath: `${targetDir}/logs/preflight.log`,
    };

    manifest.technicalRunner = {
        ...(manifest.technicalRunner || {}),
        status: normalizeEvidenceStatus(manifest.technicalRunner?.status, 'PASS|FAIL', evidenceState.runner.exists),
        reportPath: `${targetDir}/runner-report.json`,
        logPath: `${targetDir}/logs/runner.log`,
    };

    manifest.packCManual = {
        ...(manifest.packCManual || {}),
        checklistPath: `${targetDir}/pack-c-manual-checklist.md`,
        evidenceNotesPath: `${targetDir}/notes/pack-c-notes.md`,
    };

    manifest.acta = {
        ...(manifest.acta || {}),
        path: `${targetDir}/rc-acta.md`,
    };

    const artifacts = Array.isArray(manifest.artifacts) ? [...manifest.artifacts] : [];
    putArtifact(artifacts, {
        type: 'json',
        name: 'preflight-report',
        path: `${targetDir}/preflight-report.json`,
        sourcePath: `.tmp/preflight-release-${rcId}.json`,
        exists: evidenceState.preflight.exists,
    });
    putArtifact(artifacts, {
        type: 'json',
        name: 'runner-report',
        path: `${targetDir}/runner-report.json`,
        sourcePath: `.tmp/release-smokes-${rcId}.json`,
        exists: evidenceState.runner.exists,
    });
    putArtifact(artifacts, {
        type: 'markdown',
        name: 'pack-c-checklist',
        path: `${targetDir}/pack-c-manual-checklist.md`,
    });
    putArtifact(artifacts, {
        type: 'markdown',
        name: 'pack-c-notes',
        path: `${targetDir}/notes/pack-c-notes.md`,
    });
    putArtifact(artifacts, {
        type: 'markdown',
        name: 'rc-acta',
        path: `${targetDir}/rc-acta.md`,
    });
    manifest.artifacts = artifacts;

    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');
}

function copyTemplateOnce(sourcePath, targetPath, summary) {
    if (!fs.existsSync(sourcePath)) {
        summary.missing.push(toWorkspaceRelative(sourcePath));
        throw new Error(`Template faltante: ${toWorkspaceRelative(sourcePath)}`);
    }
    if (fs.existsSync(targetPath)) {
        summary.already_exists.push(toWorkspaceRelative(targetPath));
        return;
    }
    fs.copyFileSync(sourcePath, targetPath);
    summary.copied.push(toWorkspaceRelative(targetPath));
}

function copyEvidenceIfExists(sourcePath, targetPath, summary, label) {
    if (!fs.existsSync(sourcePath)) {
        summary.missing.push(toWorkspaceRelative(sourcePath));
        console.log(`[WARN] evidencia ${label} no encontrada en ${toWorkspaceRelative(sourcePath)}`);
        return false;
    }
    if (fs.existsSync(targetPath)) {
        summary.already_exists.push(toWorkspaceRelative(targetPath));
        return true;
    }
    fs.copyFileSync(sourcePath, targetPath);
    summary.copied.push(toWorkspaceRelative(targetPath));
    return true;
}

function printSummary(summary) {
    console.log('\nRC evidence assembly summary');
    console.log(`- copied (${summary.copied.length})`);
    for (const item of summary.copied) console.log(`  - ${item}`);
    console.log(`- missing (${summary.missing.length})`);
    for (const item of summary.missing) console.log(`  - ${item}`);
    console.log(`- already_exists (${summary.already_exists.length})`);
    for (const item of summary.already_exists) console.log(`  - ${item}`);
}

function main() {
    const args = parseArgs(process.argv);
    const rcId = String(args.rcId || '').trim();

    if (!rcId) {
        console.error('Uso: node scripts/assemble-release-evidence.js --rcId <RC_ID>');
        process.exit(1);
    }

    const root = process.cwd();
    const templatesDir = path.join(root, 'docs', 'release-candidates', 'templates');
    const rcDir = path.join(root, 'docs', 'release-candidates', rcId);
    const logsDir = path.join(rcDir, 'logs');
    const notesDir = path.join(rcDir, 'notes');

    const summary = {
        copied: [],
        missing: [],
        already_exists: [],
    };

    try {
        const rcDirExisted = fs.existsSync(rcDir);
        ensureDir(rcDir);
        if (rcDirExisted) summary.already_exists.push(`docs/release-candidates/${rcId}`);
        else summary.copied.push(`docs/release-candidates/${rcId}`);

        const logsDirExisted = fs.existsSync(logsDir);
        ensureDir(logsDir);
        if (logsDirExisted) summary.already_exists.push(`docs/release-candidates/${rcId}/logs`);
        else summary.copied.push(`docs/release-candidates/${rcId}/logs`);

        const notesDirExisted = fs.existsSync(notesDir);
        ensureDir(notesDir);
        if (notesDirExisted) summary.already_exists.push(`docs/release-candidates/${rcId}/notes`);
        else summary.copied.push(`docs/release-candidates/${rcId}/notes`);

        copyTemplateOnce(
            path.join(templatesDir, 'rc-acta-template.md'),
            path.join(rcDir, 'rc-acta.md'),
            summary,
        );
        copyTemplateOnce(
            path.join(templatesDir, 'pack-c-manual-checklist-template.md'),
            path.join(rcDir, 'pack-c-manual-checklist.md'),
            summary,
        );
        copyTemplateOnce(
            path.join(templatesDir, 'evidence-manifest-template.json'),
            path.join(rcDir, 'evidence-manifest.json'),
            summary,
        );

        const preflightExists = copyEvidenceIfExists(
            path.join(root, '.tmp', `preflight-release-${rcId}.json`),
            path.join(rcDir, 'preflight-report.json'),
            summary,
            'preflight',
        );
        const runnerExists = copyEvidenceIfExists(
            path.join(root, '.tmp', `release-smokes-${rcId}.json`),
            path.join(rcDir, 'runner-report.json'),
            summary,
            'runner',
        );

        upsertManifest(
            path.join(rcDir, 'evidence-manifest.json'),
            path.join(templatesDir, 'evidence-manifest-template.json'),
            rcId,
            {
                preflight: { exists: preflightExists },
                runner: { exists: runnerExists },
            },
        );

        if (summary.copied.includes(`docs/release-candidates/${rcId}/evidence-manifest.json`)) {
            summary.copied.push(`docs/release-candidates/${rcId}/evidence-manifest.json (updated)`);
        } else {
            summary.already_exists.push(`docs/release-candidates/${rcId}/evidence-manifest.json (updated)`);
        }

        printSummary(summary);
    } catch (error) {
        console.error(`[ERROR] ${String(error?.message || error)}`);
        printSummary(summary);
        process.exit(1);
    }
}

main();

