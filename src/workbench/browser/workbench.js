/*---------------------------------------------------------------------------------------------
 *  LionOrganizer — Copyright (C) 2026 LionOrganizer Team.
 *  Created and conceived by Daniel Michelon De Carli.
 *  Licensed under the GNU General Public License v3.0 or later. See LICENSE in the project root.
 *--------------------------------------------------------------------------------------------*/
// Workbench startup: creates the services once and injects them into the
// layout parts — the same principle as VS Code, in a lean version.
import { AnalysisService } from '../services/analysis/browser/analysisService.js';
import { ScanService } from '../services/scan/browser/scanService.js';
import { LayoutService } from '../services/layout/browser/layoutService.js';
import { NotificationService } from '../services/notification/browser/notificationService.js';
import { FileActionsService } from '../services/actions/browser/fileActionsService.js';
import { ConfirmationService } from '../services/dialog/browser/confirmationService.js';
import { OperationsService } from '../services/operations/browser/operationsService.js';
import { DuplicatesService } from '../services/duplicates/browser/duplicatesService.js';
import { CatalogService } from '../services/catalog/browser/catalogService.js';
import { UpdateService } from '../services/update/browser/updateService.js';
import { AiReportService } from '../services/report/browser/aiReportService.js';

import { TitlebarPart } from './parts/titlebarPart.js';
import { ActivitybarPart } from './parts/activitybarPart.js';
import { SidebarPart } from './parts/sidebarPart.js';
import { EditorPart } from './parts/editorPart.js';
import { StatusbarPart } from './parts/statusbarPart.js';

import { OverviewView } from '../contrib/overview/overviewView.js';
import { FilesView } from '../contrib/files/filesView.js';
import { CleanupView } from '../contrib/cleanup/cleanupView.js';
import { DuplicatesView } from '../contrib/duplicates/duplicatesView.js';
import { OrganizeView } from '../contrib/organize/organizeView.js';
import { CatalogView } from '../contrib/catalog/catalogView.js';
import { TreemapView } from '../contrib/treemap/treemapView.js';
import { h } from '../../base/browser/dom.js';
import { t, tn, consumeRescanFlag } from '../../base/common/nls.js';
import { baseName, formatNumber } from '../../base/common/format.js';
import { bootStatus, bootSkip, bootDone } from './boot.js';
import { VIEWS } from '../services/layout/browser/layoutService.js';

const host = window.host;
if (!host) throw new Error(t('workbench.preloadMissing'));
document.documentElement.dataset.platform = host.platform;

// ---- services ----
const services = {};
services.host = host;
services.layout = new LayoutService(host);
services.analysis = new AnalysisService(host);
services.scan = new ScanService(host, services.analysis);
services.notifications = new NotificationService();
services.confirmation = new ConfirmationService();
services.operations = new OperationsService(services);
services.actions = new FileActionsService(services);
services.duplicates = new DuplicatesService(services);
services.catalog = new CatalogService(services);
services.update = new UpdateService(services);
services.report = new AiReportService(services);
// moved/renamed files are still recognized in the duplicate groups
services.operations.onDidRun(({ result }) => services.duplicates.trackMoves(result.moved));

// ---- editor views (contributions) ----
const views = {
  overview: new OverviewView(services),
  files: new FilesView(services),
  cleanup: new CleanupView(services),
  duplicates: new DuplicatesView(services),
  organize: new OrganizeView(services),
  catalog: new CatalogView(services),
  treemap: new TreemapView(services),
};

// ---- layout ----
const root = document.getElementById('workbench');
const titlebar = new TitlebarPart(services);
const activitybar = new ActivitybarPart(services);
const sidebar = new SidebarPart(services);
const editor = new EditorPart(services, views);
const statusbar = new StatusbarPart(services);

root.append(
  titlebar.element,
  h('div.workbench-main', activitybar.element, sidebar.element, editor.element),
  statusbar.element,
  services.notifications.element,
);

// ---- startup ----
// Nothing is analyzed automatically: analyzing is always the person's choice. At startup the app only
//  1) analyzes the folder it was reopened for as administrator (Windows) — the person just asked for it;
//  2) otherwise shows the last analysis saved in the catalog, with its date ("Analyze now" refreshes it).
// The loading screen says what is happening meanwhile.
(async () => {
  consumeRescanFlag(); // flag of older versions: a language change no longer re-analyzes
  try {
    const initial = await host.takeInitialScan?.().catch(() => null);
    if (initial) { services.scan.scan(initial); return; }
    const folder = services.scan.folder;
    if (!folder) return;
    let skipped = false;
    bootSkip(t('boot.skip'), () => { skipped = true; bootDone(); });
    await services.scan.reopen(folder, {
      isCancelled: () => skipped,
      onStatus: (stage, value, done) => stage === 'reading'
        ? bootStatus(t('boot.reading', { folder: baseName(folder) || folder }),
          value?.total ? t('boot.readingCount', { done: formatNumber(value.done), total: formatNumber(value.total), pct: Math.min(99, Math.round(value.done / value.total * 100)) }) : folder)
        : bootStatus(tn('boot.preparing', value), done ? t('boot.readingCount', { done: formatNumber(done), total: formatNumber(value), pct: Math.min(99, Math.round(done / (value || 1) * 100)) }) : folder),
    });
  } catch (err) {
    console.error(err);
  } finally {
    bootDone();
  }
})();

// A background refresh replaced the saved analysis: say so, with what changed since then.
services.scan.onDidFinish(({ background, result }) => {
  if (!background) return;
  const c = result.catalog?.changes;
  const changed = c ? c.new + c.removed + c.grew + c.shrank : 0;
  services.notifications.info(changed
    ? t('restore.updatedChanges', { new: tn('restore.count.new', c.new), removed: tn('restore.count.removed', c.removed), changed: tn('restore.count.changed', c.grew + c.shrank) })
    : t('restore.updated'), 7000);
});

// ---- keyboard shortcuts ----
// Back to the window: files may have been deleted, moved or restored meanwhile (e.g. in Explorer).
window.addEventListener('focus', () => services.analysis.recheck());

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); services.actions.openFolderAndScan(); }
  else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); services.layout.toggleSidebar(); }
  else if (mod && /^[1-7]$/.test(e.key)) { e.preventDefault(); services.layout.openView(VIEWS[+e.key - 1].id); }
  else if (e.key === 'F5') { e.preventDefault(); services.scan.scan(); }
  else if (e.key === 'Escape' && services.scan.busy && !document.fullscreenElement) services.scan.cancel();
  else if (e.key === 'Escape' && services.duplicates.status === 'running') services.duplicates.cancel();
});
