import { appendFileSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const mode = process.argv[2];
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8', env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.error?.message || 'GitHub release operation failed');
  return result.stdout.trim();
}
function walk(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

if (mode === 'prepare') {
  const tag = process.env.GITHUB_REF_TYPE === 'tag'
    ? process.env.GITHUB_REF_NAME
    : `build-v${version}-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  if (process.env.GITHUB_REF_TYPE === 'tag' && tag !== `v${version}`) throw new Error('Release tag must match application version');
  const notes = 'Private draft build. Validation and platform packaging are in progress; see the linked workflow for actual results.';
  gh(['release', 'create', tag, '--draft', '--target', process.env.GITHUB_SHA, '--title', `Toolbox EX ${version} · building`, '--notes', notes]);
  appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
  console.log(`Created private draft ${tag}`);
} else {
  const tag = process.env.BUILD_RELEASE_TAG;
  if (!tag) throw new Error('Missing build release tag');
  const release = JSON.parse(gh(['release', 'view', tag, '--json', 'isDraft,targetCommitish,url']));
  if (!release.isDraft || release.targetCommitish !== process.env.GITHUB_SHA) throw new Error('Refusing to modify a non-draft release or a different source commit');
  if (mode === 'screenshots' || mode === 'installers') {
    const files = mode === 'screenshots'
      ? walk('test-results').filter(path => /(?:workbench|launcher|dark-theme)\.png$/.test(path))
      : walk('artifacts');
    if (!files.length) throw new Error('No build outputs available for upload');
    gh(['release', 'upload', tag, ...files]);
    console.log(`Attached ${files.length} ${mode} files to ${release.url}`);
  } else if (mode === 'finish') {
    const complete = process.env.QUALITY_RESULT === 'success' && process.env.DESKTOP_RESULT === 'success';
    const notes = readFileSync('docs/RELEASE_NOTES.md', 'utf8')
      + `\n## Build evidence\n\nSource: ${process.env.GITHUB_SHA}\n\nUI checks: ${process.env.QUALITY_RESULT}; desktop installers: ${process.env.DESKTOP_RESULT}.\n\nWorkflow: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}\n`;
    writeFileSync('release-build-notes.md', notes);
    gh(['release', 'edit', tag, '--title', `Toolbox EX ${version} · ${complete ? 'ready to install' : 'incomplete build'}`, '--notes-file', 'release-build-notes.md']);
    // GitHub can replace a draft's temporary URL when its title or notes change.
    const releasesUrl = `https://github.com/${process.env.GITHUB_REPOSITORY}/releases`;
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Toolbox EX ${version}\n\n[Open private releases and download this build](${releasesUrl})\n\nBuild tag: \`${tag}\`\n\nUI checks: **${process.env.QUALITY_RESULT}** · Desktop packages: **${process.env.DESKTOP_RESULT}**\n`);
  } else throw new Error('Unknown release-assets operation');
}
