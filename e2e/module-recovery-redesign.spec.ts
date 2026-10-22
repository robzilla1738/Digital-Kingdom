import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test, expect, type BrowserContext } from '@playwright/test';
import { captureRedesign, createRedesignHarness, writeRedesignEvidence, type RedesignHarness } from './redesign-harness.ts';

let h: RedesignHarness;
test.beforeAll(async () => { h = await createRedesignHarness(); });
test.afterAll(async () => { await h?.close(); });

test('15.3: one invalid visual module becomes a named neutral block without changing canonical evidence', async ({ browser }) => {
  const before = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
  const asset = before.graph.assets.find((a: { id: string }) => a.id === 'edge');
  const needle = 'case"gatehouse":', directory = new URL('../apps/web/dist/assets/', import.meta.url);
  const bundles = readdirSync(directory).filter(name => name.endsWith('.js') && readFileSync(new URL(name, directory), 'utf8').includes(needle));
  expect(bundles, 'One actual production geometry factory is the explicit fault target').toHaveLength(1);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage(), messages: string[] = [], errors: string[] = [], mutations: string[] = [];
  let injected = 0;
  page.on('console', message => messages.push(message.text())); page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/projects/')) mutations.push(request.method() + ' ' + new URL(request.url()).pathname); });
  try {
    await context.route(`**/assets/${bundles[0]}`, async route => {
      const response = await route.fetch(), body = await response.text();
      expect(body.split(needle)).toHaveLength(2); injected++;
      // Only this local model constructor is corrupted. No API response, evidence record,
      // authentication result, WebGL status, or shader ownership is mocked.
      await route.fulfill({ response, body: body.replace(needle, needle + 'throw new Error("INJECTED_PRIVATE_GEOMETRY_DETAIL");') });
    });
    await page.goto(h.serverUrl + '/?project=demo-castle#workspace=kingdom&view=castle&sel=asset:api');
    await page.getByLabel('API token').fill(h.adminToken); await page.getByRole('button', { name: /^Sign in$/ }).click();
    const canvas = page.locator('canvas'), failed = page.locator('[data-asset-label="edge"]');
    await expect(failed).toHaveAttribute('data-module-recovery', 'invalid_asset_pack_geometry');
    await expect(failed).toBeVisible(); await expect(failed).toContainText(asset.name); await expect(failed).toContainText('Model unavailable · neutral block');
    await expect(page.getByRole('radio', { name: '3D castle', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => Number(await canvas.getAttribute('data-render-count'))).toBeGreaterThan(0);
    await expect(page.locator('[data-module-recovery]')).toHaveCount(1);
    await expect(page.locator('[data-asset-label]')).toHaveCount(before.graph.assets.length);
    const healthy = page.locator('[data-asset-label="api"]');
    await expect(healthy).toBeVisible(); await expect(healthy).not.toHaveAttribute('data-module-recovery');
    await page.waitForTimeout(300); const originalPose = await canvas.getAttribute('data-camera-pose');
    await failed.click(); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', 'edge');
    expect(await canvas.getAttribute('data-camera-pose')).toBe(originalPose);
    await captureRedesign(page, 'module-geometry-failure-one-neutral-block');
    await page.getByRole('toolbar', { name: 'Castle view' }).getByRole('button', { name: 'Focus selection', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-camera-active', 'true');
    await expect(canvas).toHaveAttribute('data-camera-active', 'false');
    await expect.poll(() => canvas.getAttribute('data-camera-pose')).not.toBe(originalPose);
    await captureRedesign(page, 'module-geometry-failure-canonical-focus');
    // Fit back to the actual courtyard, then select a different, intact building.
    await page.getByRole('toolbar', { name: 'Castle view' }).getByRole('button', { name: 'Fit all assets', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-camera-active', 'true'); await expect(canvas).toHaveAttribute('data-camera-active', 'false');
    const other = page.locator('[data-asset-label]:not([data-module-recovery]):visible').first();
    await expect(other).toBeVisible(); const otherId = await other.getAttribute('data-asset-label');
    expect(before.graph.assets.some((a: { id: string }) => a.id === otherId)).toBe(true);
    await other.click(); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', otherId!);
    await expect(canvas).toBeVisible(); await expect(page.locator('[data-module-recovery]')).toHaveCount(1);
    const after = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
    for (const field of ['graph', 'events', 'findings', 'scene', 'evidence']) expect(after[field]).toEqual(before[field]);
    expect(injected).toBe(1); expect(mutations).toEqual([]);
    // R3F forwards React's caught, sanitized geometry error to window.reportError. This is
    // an expected injected fault, not an uncaught renderer collapse; all other errors fail.
    expect(errors).toEqual(['The local architectural module geometry is unavailable.']);
    const diagnostics = messages.filter(message => message.startsWith('Digital Kingdom renderer'));
    expect(diagnostics).toHaveLength(1); expect(diagnostics[0]).toContain('invalid_asset_pack_geometry');
    expect(messages.join('\n')).not.toContain('INJECTED_PRIVATE_GEOMETRY_DETAIL');
    writeRedesignEvidence('module-geometry-failure.json', {
      scope: 'Actual production bundle, isolated synthetic API project; one constructor corrupted through an explicit Playwright asset-response injection.',
      injectedBundle: bundles[0], fault: 'gatehouse construction throws; original payload is sanitized', affectedAsset: { id: asset.id, name: asset.name },
      classifiedDiagnosticCount: diagnostics.length, expectedSanitizedFrameworkErrors: errors, canonicalRecordsUnchanged: ['graph', 'events', 'findings', 'scene', 'evidence'], mutationRequests: mutations,
      beforeEvidenceSha256: createHash('sha256').update(JSON.stringify({ graph: before.graph, events: before.events, findings: before.findings, scene: before.scene })).digest('hex'),
      selectionPreserved: true, explicitFocusWorks: true, otherBuildingSelectable: otherId, remainsIn3D: true,
      limitations: 'This geometry-only test does not cover shader faults; separate owned body/roof/directional-depth shader tests cover attributable compilation failures. Unowned/global shader and WebGL context-loss failures retain separate renderer recovery. Arbitrary asynchronous driver failures are not inferred from module identity. Unsupported stored scene metadata is not tested; the injected module ID is valid. No API or authorization failure was injected or reclassified.',
    });
  } finally { await context.close(); }
});

test('15.3: a valid scene replacement clears the failed label for the same canonical asset', async ({ browser }) => {
  const before = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
  const proposal = (module_id: string) => ({ schema_version: '0.2', graph_revision: before.graph.graph_revision, seed: before.scene.seed,
    style_profile: 'stone-slate-v1', camera_profile: 'isometric-v1', placements: before.scene.rooms.map((r: { asset_id: string; zone_id: string; module_id: string }) => ({ asset_id: r.asset_id, zone_id: r.zone_id, module_id: r.asset_id === 'api' ? module_id : r.module_id })) });
  expect((await h.api('POST', '/api/projects/demo-castle/scene', proposal('great_hall'))).status).toBe(200);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }), page = await context.newPage();
  const needle = 'case"great_hall":', directory = new URL('../apps/web/dist/assets/', import.meta.url);
  const bundles = readdirSync(directory).filter(name => name.endsWith('.js') && readFileSync(new URL(name, directory), 'utf8').includes(needle));
  expect(bundles).toHaveLength(1);
  try {
    await context.route(`**/assets/${bundles[0]}`, async route => {
      const response = await route.fetch(), body = await response.text(); expect(body.split(needle)).toHaveLength(2);
      await route.fulfill({ response, body: body.replace(needle, needle + 'throw new Error("INJECTED_MODEL_REPLACEMENT_FAULT");') });
    });
    await page.goto(h.serverUrl + '/?project=demo-castle#workspace=kingdom&view=castle&sel=asset:api');
    await page.getByLabel('API token').fill(h.adminToken); await page.getByRole('button', { name: /^Sign in$/ }).click();
    const label = page.locator('[data-asset-label="api"]');
    await expect(label).toHaveAttribute('data-module-recovery', 'invalid_asset_pack_geometry');
    await expect(label).toContainText('Model unavailable · neutral block'); await expect(label).toContainText('orders-api');
    await expect(page.locator('[data-module-recovery]')).toHaveCount(1);
    const canvas = page.locator('canvas'); await canvas.evaluate(node => node.setAttribute('data-recovery-mount-marker', 'same-canvas'));
    expect((await h.api('POST', '/api/projects/demo-castle/scene', proposal('hall'))).status).toBe(200);
    // Selected evidence deliberately pins the prior snapshot. Apply the confirmed update
    // through its real control, rather than bypassing snapshot/replay semantics.
    const apply = page.getByRole('button', { name: 'Return to latest', exact: true });
    await expect(apply).toBeEnabled(); await expect(label).toHaveAttribute('data-module-recovery', 'invalid_asset_pack_geometry');
    await apply.click();
    await expect(label).not.toHaveAttribute('data-module-recovery'); await expect(label).not.toContainText('Model unavailable');
    await expect(label).toBeVisible(); await expect(label).toContainText('orders-api');
    await expect(label).not.toHaveAttribute('aria-label', /Visual module unavailable/);
    await expect(page.locator('[data-module-recovery]')).toHaveCount(0);
    await expect(canvas).toHaveAttribute('data-recovery-mount-marker', 'same-canvas');
    await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', 'api');
    const after = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
    for (const field of ['graph', 'events', 'findings', 'evidence']) expect(after[field]).toEqual(before[field]);
    expect(after.scene.rooms.find((r: { asset_id: string }) => r.asset_id === 'api').module_id).toBe('hall');
    await captureRedesign(page, 'module-geometry-replacement-healthy-same-asset');
    writeRedesignEvidence('module-geometry-replacement.json', { scope: 'Two real accepted scene proposals on an isolated synthetic API project; great_hall alone fails, then hall replaces it on the same mounted Canvas.', assetId: 'api', assetName: 'orders-api', acceptedModules: ['great_hall', 'hall'], staleRecoveryLabelCleared: true, explicitConfirmedSnapshotApplied: true, canonicalRecordsUnchanged: ['graph', 'events', 'findings', 'evidence'], sceneOnlyChangedByExplicitTestProposals: true });
  } finally { await context.close(); }
});

async function injectModuleShaderFault(context: BrowserContext, targetName: string) {
  await context.addInitScript(({ targetName }) => {
    const probe = { injections: 0, compileFailures: 0, linkFailures: 0, target: targetName };
    (window as any).__moduleShaderProbe = probe;
    for (const Constructor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
      if (!Constructor) continue;
      const prototype = Constructor.prototype, source = prototype.shaderSource, compile = prototype.compileShader, link = prototype.linkProgram;
      const bad = new WeakSet<WebGLShader>();
      prototype.shaderSource = function(shader: WebGLShader, text: string) {
        if (this.getShaderParameter(shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER && text.includes(`#define SHADER_NAME ${probe.target}\n`)) {
          bad.add(shader); probe.injections++; text += '\nINJECTED_PRIVATE_SHADER_PAYLOAD invalid GLSL;\n';
        }
        return source.call(this, shader, text);
      };
      prototype.compileShader = function(shader: WebGLShader) {
        const result = compile.call(this, shader);
        if (bad.has(shader) && this.getShaderParameter(shader, this.COMPILE_STATUS) === false) probe.compileFailures++;
        return result;
      };
      prototype.linkProgram = function(program: WebGLProgram) {
        const result = link.call(this, program);
        if ((this.getAttachedShaders(program) ?? []).some(shader => bad.has(shader)) && this.getProgramParameter(program, this.LINK_STATUS) === false) probe.linkFailures++;
        return result;
      };
    }
  }, { targetName });
}

for (const part of ['body', 'roof', 'depth'] as const) test(`15.3: real ${part} GLSL compile failure recovers only its owned module family`, async ({ browser }) => {
  const before = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }), page = await context.newPage();
  await injectModuleShaderFault(context, `dk_arch_gatehouse_${part}`);
  const messages: string[] = [], errors: string[] = [];
  page.on('console', message => messages.push(message.text())); page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(h.serverUrl + '/?project=demo-castle#workspace=kingdom&view=castle&sel=asset:api');
    await page.getByLabel('API token').fill(h.adminToken); await page.getByRole('button', { name: /^Sign in$/ }).click();
    const canvas = page.locator('canvas'), failed = page.locator('[data-asset-label="edge"]');
    await expect(failed).toHaveAttribute('data-module-recovery', 'module_shader_failure'); await expect(failed).toContainText('public-edge');
    await expect(failed).toContainText('Model unavailable · neutral block'); await expect(failed).toBeVisible();
    await expect(page.locator('[data-module-recovery]')).toHaveCount(1);
    await expect(page.getByRole('radio', { name: '3D castle', exact: true })).toHaveAttribute('aria-checked', 'true');
    const driver = await page.evaluate(() => (window as any).__moduleShaderProbe);
    expect(driver.injections).toBeGreaterThan(0); expect(driver.compileFailures).toBeGreaterThan(0); expect(driver.linkFailures).toBeGreaterThan(0);
    await expect(canvas).toHaveAttribute('data-module-shader-owners', String(before.graph.assets.length - 1));
    const other = page.locator('[data-asset-label]:not([data-module-recovery]):visible').first();
    await expect(other).toBeVisible(); const otherId = await other.getAttribute('data-asset-label');
    await other.click(); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', otherId!);
    await failed.click(); await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', 'edge');
    const pose = await canvas.getAttribute('data-camera-pose');
    await page.getByRole('toolbar', { name: 'Castle view' }).getByRole('button', { name: 'Focus selection', exact: true }).click();
    await expect(canvas).toHaveAttribute('data-camera-active', 'true'); await expect(canvas).toHaveAttribute('data-camera-active', 'false');
    expect(await canvas.getAttribute('data-camera-pose')).not.toBe(pose);
    await captureRedesign(page, `module-shader-${part}-neutral-recovery`);
    const after = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
    for (const field of ['graph', 'events', 'findings', 'scene', 'evidence']) expect(after[field]).toEqual(before[field]);
    expect(errors).toEqual([]); expect(messages.join('\n')).not.toContain('INJECTED_PRIVATE_SHADER_PAYLOAD');
    const diagnostics = messages.filter(message => message.startsWith('Digital Kingdom renderer'));
    expect(diagnostics).toHaveLength(1); expect(diagnostics[0]).toContain('module_shader_failure');
    writeRedesignEvidence(`module-shader-${part}-failure.json`, { embeddedBuild: await page.locator('meta[name="dk-build"]').getAttribute('content'), scope: 'Real invalid fragment GLSL in one explicitly isolated module-family program; native compile and link status checked, no callback or result spoofed.', driver, classifiedDiagnostics: diagnostics, pageErrors: errors, affectedAsset: 'edge', otherBuildingSelectable: otherId, canonicalRecordsUnchanged: ['graph', 'events', 'findings', 'scene', 'evidence'], remainingShaderOwners: await canvas.getAttribute('data-module-shader-owners'), selectedAsset: 'edge', explicitFocusWorks: true, part });
  } finally { await context.close(); }
});

test('15.3: one failed shader family notifies every asset owner and a healthy replacement clears only its own marker', async ({ browser }) => {
  const before = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
  const otherId = before.graph.assets.find((a: { id: string; kind: string }) => a.kind === 'service' && a.id !== 'api').id;
  const ids = new Set(['api', otherId]);
  const proposal = (apiModule: 'hall' | 'great_hall') => ({ schema_version: '0.2', graph_revision: before.graph.graph_revision, seed: before.scene.seed,
    style_profile: 'stone-slate-v1', camera_profile: 'isometric-v1', placements: before.scene.rooms.map((r: { asset_id: string; zone_id: string; module_id: string }) => ({ asset_id: r.asset_id, zone_id: r.zone_id, module_id: r.asset_id === 'api' ? apiModule : ids.has(r.asset_id) ? 'great_hall' : r.module_id })) });
  expect((await h.api('POST', '/api/projects/demo-castle/scene', proposal('great_hall'))).status).toBe(200);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }), page = await context.newPage();
  await injectModuleShaderFault(context, 'dk_arch_great_hall_body');
  const messages: string[] = [], errors: string[] = [];
  page.on('console', message => messages.push(message.text())); page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(h.serverUrl + '/?project=demo-castle#workspace=kingdom&view=castle&sel=asset:api');
    await page.getByLabel('API token').fill(h.adminToken); await page.getByRole('button', { name: /^Sign in$/ }).click();
    const canvas = page.locator('canvas'), api = page.locator('[data-asset-label="api"]'), other = page.locator(`[data-asset-label="${otherId}"]`);
    for (const label of [api, other]) await expect(label).toHaveAttribute('data-module-recovery', 'module_shader_failure');
    await expect(page.locator('[data-module-recovery]')).toHaveCount(2);
    const driver = await page.evaluate(() => (window as any).__moduleShaderProbe);
    expect(driver.compileFailures).toBeGreaterThan(0); expect(driver.linkFailures).toBeGreaterThan(0);
    await expect(canvas).toHaveAttribute('data-module-shader-owners', String(before.graph.assets.length - 2));
    const originalCanvas = await canvas.elementHandle();
    const programs: number[] = [];
    for (const moduleId of ['hall', 'great_hall', 'hall', 'great_hall', 'hall'] as const) {
      expect((await h.api('POST', '/api/projects/demo-castle/scene', proposal(moduleId))).status).toBe(200);
      const apply = page.getByRole('button', { name: 'Return to latest', exact: true }); await expect(apply).toBeEnabled(); await apply.click();
      if (moduleId === 'hall') {
        await expect(api).not.toHaveAttribute('data-module-recovery'); await expect(api).not.toContainText('Model unavailable');
        await expect(page.locator('[data-module-recovery]')).toHaveCount(1);
        await expect(canvas).toHaveAttribute('data-module-shader-owners', String(before.graph.assets.length - 1));
        programs.push(Number(await canvas.getAttribute('data-gpu-programs')));
      } else await expect(api).toHaveAttribute('data-module-recovery', 'module_shader_failure');
      await expect(other).toHaveAttribute('data-module-recovery', 'module_shader_failure');
      expect(await originalCanvas!.evaluate(node => node.isConnected)).toBe(true);
      await expect(page.locator('aside.evidence')).toHaveAttribute('data-selection-id', 'api');
    }
    expect(programs[0]).toBeGreaterThan(0); expect(programs.at(-1)!).toBeLessThanOrEqual(programs[0]! + 2);
    await captureRedesign(page, 'module-shader-family-healthy-replacement');
    const after = (await h.api('GET', '/api/projects/demo-castle/snapshot')).json;
    for (const field of ['graph', 'events', 'findings', 'evidence']) expect(after[field]).toEqual(before[field]);
    expect(messages.join('\n')).not.toContain('INJECTED_PRIVATE_SHADER_PAYLOAD'); expect(errors).toEqual([]);
    const diagnostics = messages.filter(message => message.startsWith('Digital Kingdom renderer')); expect(diagnostics).toHaveLength(1);
    await page.getByRole('radio', { name: '2D graph', exact: true }).click();
    await expect.poll(() => originalCanvas!.evaluate(node => node.dataset.moduleShaderOwners)).toBeUndefined();
    await expect.poll(() => originalCanvas!.evaluate(node => (node.getContext('webgl2') ?? node.getContext('webgl'))?.isContextLost())).toBe(true);
    await originalCanvas!.dispose();
    writeRedesignEvidence('module-shader-family-replacement.json', { embeddedBuild: await page.locator('meta[name="dk-build"]').getAttribute('content'), affectedAssets: [...ids], driver, shaderOwnerCounts: [before.graph.assets.length - 2, before.graph.assets.length - 1], replacementAsset: 'api', replacementModule: 'hall', otherFailedAssetRemainsMarked: otherId, shaderProgramSamplesAcrossRepeatedReplacement: programs, sameCanvasRetainedDuringReplacement: true, ownersReleasedOnUnmount: true, nativeContextLostOnUnmount: true, classifiedDiagnostics: diagnostics, canonicalRecordsUnchanged: ['graph', 'events', 'findings', 'evidence'], scope: 'Real accepted scene proposals and native shader compilation failure; explicitly applied confirmed snapshots, without changing canonical asset identity or evidence.' });
  } finally { await context.close(); }
});
