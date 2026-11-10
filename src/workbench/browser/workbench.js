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
import { h } from '../../base/browser/dom.js';
import { t, consumeRescanFlag } from '../../base/common/nls.js';

const host = window.host;
if (!host) throw new Error(t('workbench.preloadMissing'));
document.documentElement.dataset.platform = host.platform;

// ---- services ----
const services = {};
services.host = host;
services.layout = new LayoutService(host);
services.analysis = new AnalysisService();
services.scan = new ScanService(host, services.analysis);
services.notifications = new NotificationService();
services.confirmation = new ConfirmationService();
services.operations = new OperationsService(services);
services.actions = new FileActionsService(services);
services.duplicates = new DuplicatesService(services);
services.catalog = new CatalogService(services);
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

// after a language change (window reload), re-run the analysis that was open
if (consumeRescanFlag() && services.scan.folder) services.scan.scan();

// ---- keyboard shortcuts ----
window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); services.actions.openFolderAndScan(); }
  else if (mod && e.key.toLowerCase() === 'b') { e.preventDefault(); services.layout.toggleSidebar(); }
  else if (mod && /^[1-6]$/.test(e.key)) { e.preventDefault(); services.layout.openView(['overview', 'files', 'cleanup', 'duplicates', 'organize', 'catalog'][+e.key - 1]); }
  else if (e.key === 'F5') { e.preventDefault(); services.scan.scan(); }
  else if (e.key === 'Escape' && services.scan.state === 'scanning') services.scan.cancel();
  else if (e.key === 'Escape' && services.duplicates.status === 'running') services.duplicates.cancel();
});
