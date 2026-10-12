/* Render the design library without dependencies or external services. */
(function () {
  'use strict';
  var root = document.getElementById('yudao-design-app');
  if (!root) return;
  var config;
  try { config = JSON.parse(root.dataset.config || '{}'); } catch (error) {
    root.textContent = '项目库配置无法读取，请联系管理员。'; return;
  }
  var state = { projects: [], project: null, version: '', imageRole: 'effect', loading: false, uploading: false, files: [], limits: config.limits || {}, xhr: null, notice: '', uploadOpen: false, configuring: false, requestId: '', requestSignature: '', savedReceipt: null, detailRevision: 0 };
  var lightbox = null, previousFocus = null, zoom = 1, lightboxIndex = 0, lightboxImages = [], compareSelection = ['', ''], captionDrafts = Object.create(null), accessDrafts = Object.create(null);
  var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function safeUrl(value, base) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f\\]/.test(value) || /^\/\//.test(value)) return '';
    try { var url = new URL(value, base || document.baseURI); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch (error) { return ''; }
  }
  var apiUrl = safeUrl(config.apiUrl);
  if (!apiUrl) { root.textContent = '项目库接口地址无效，请联系管理员。'; return; }
  var canUpload = config.canUpload === true || config.canUpload === 1 || config.canUpload === '1';
  function pageLink(id, versionId, section, role) {
    var url = new URL(safeUrl(config.baseUrl) || window.location.href);
    ['project', 'version', 'role'].forEach(function (key) { url.searchParams.delete(key); });
    if (id) url.searchParams.set('project', id);
    if (id && versionId) url.searchParams.set('version', versionId);
    if (id && role) url.searchParams.set('role', role);
    url.hash = section || '';
    return url.href;
  }
  function syncVersionUrl(section, role) {
    window.history.replaceState(null, '', pageLink(state.project.id, state.version, section, role));
  }
  function focusSection(section) {
    var target = root.querySelector('#' + section);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'start' }); target.setAttribute('tabindex', '-1'); target.focus({ preventScroll: true }); }
  }
  function endpoint(method, params) {
    var url = new URL(apiUrl); url.searchParams.set('method', method);
    Object.keys(params || {}).forEach(function (key) { url.searchParams.set(key, params[key]); });
    return url.href;
  }
  function responseResult(data) {
    if (!data || data.stat !== 'ok' || !data.result) throw new Error(data && (data.message || data.error) || '服务器未返回有效结果。');
    return data.result;
  }
  async function get(method, params) {
    var response = await fetch(endpoint(method, params), { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    var data;
    try { data = await response.json(); } catch (error) { throw new Error(response.ok ? '服务器响应无法读取。' : '接口请求失败（HTTP ' + response.status + '）。'); }
    if (!response.ok) throw new Error(data && (data.message || data.error) || '接口请求失败（HTTP ' + response.status + '）。');
    return responseResult(data);
  }
  function versions(project) { return project && Array.isArray(project.versions) ? project.versions : []; }
  function latest(project) {
    return versions(project).reduce(function (chosen, version) {
      if (!chosen) return version;
      var a = Date.parse(chosen.created_at), b = Date.parse(version.created_at);
      return Number.isFinite(a) && Number.isFinite(b) ? (b > a ? version : chosen) : version;
    }, null);
  }
  function chooseImageRole(version) { state.imageRole = assets(version).some(function (a) { return a.kind === 'image' && a.role !== 'source'; }) ? 'effect' : 'source'; }
  function defaultVersion(project) { return versions(project).find(function (v) { return String(v.id) === String(project.current_version_id); }) || latest(project); }
  function activeVersion() { return versions(state.project).find(function (v) { return String(v.id) === state.version; }) || defaultVersion(state.project); }
  function projectAssets(project) { return versions(project).flatMap(function (version) { return assets(version).map(function (asset) { return { asset: asset, version: version }; }); }); }
  function projectCover(project) { var configured = projectAssets(project).find(function (item) { return String(item.asset.id) === String(project.cover_asset_id) && item.asset.kind === 'image' && safeUrl(item.asset.url); }); var images = assets(defaultVersion(project)).filter(function (a) { return a.kind === 'image' && safeUrl(a.url); }); return configured ? configured.asset : images.find(function (a) { return a.role === 'effect'; }) || images[0]; }
  function assets(version) { return version && Array.isArray(version.assets) ? version.assets : []; }
  function date(value) { var d = new Date(value); return Number.isNaN(d.getTime()) ? '日期未记录' : d.toLocaleDateString('zh-CN'); }
  function bytes(value) {
    var n = Number(value); if (!Number.isFinite(n) || n < 0) return '';
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB';
  }
  function imageTitle(asset) { return asset.caption || asset.name || '项目图片'; }
  function imageRole(asset) { return asset.role === 'source' ? '原始现场' : asset.role === 'effect' ? '效果图' : '未标注类型'; }
  function imagePreview(asset, alt) {
    var original = safeUrl(asset.url), previews = asset.previews || {}, small = safeUrl(previews['400']), large = safeUrl(previews['800']);
    if (!original) return '';
    // Preview keys are maximum edge lengths, not image widths. Density descriptors
    // avoid misrepresenting portrait/landscape dimensions as width metadata.
    return '<img src="' + esc(small || large || original) + '"' + (small && large ? ' srcset="' + esc(small) + ' 1x, ' + esc(large) + ' 2x" sizes="(max-width: 680px) calc(100vw - 36px), (max-width: 1000px) 45vw, 400px"' : '') + ' data-original-src="' + esc(original) + '" alt="' + esc(alt || imageTitle(asset)) + '" loading="lazy" decoding="async">';
  }
  function bindImagePreviews() {
    root.querySelectorAll('img[data-original-src]').forEach(function (image) {
      function fallback() { if (image.dataset.previewFallback) return; image.dataset.previewFallback = 'true'; image.removeAttribute('srcset'); image.removeAttribute('sizes'); image.src = image.dataset.originalSrc; }
      image.addEventListener('error', fallback);
      if (image.complete && !image.naturalWidth) fallback();
    });
  }
  function notice(message, error) { state.notice = message; var node = root.querySelector('[data-notice]'); if (!node) { node = document.createElement('div'); node.className = 'yd-notice'; node.dataset.notice = ''; root.prepend(node); } if (node) { node.innerHTML = esc(message) + receiptLink(); node.hidden = !message; node.classList.toggle('yd-error', !!error); node.setAttribute('role', error ? 'alert' : 'status'); } }
  function header() {
    return '<header class="yd-header"><a class="yd-brand" href="' + esc(pageLink()) + '"><span class="yd-brand-mark" aria-hidden="true">渔</span><span>渔岛设计资料库<small>项目 · 方案 · 现场资料</small></span></a><nav aria-label="项目导航"><a href="' + esc(pageLink()) + '">全部项目</a>' + (canUpload ? '<button type="button" class="yd-button yd-primary" data-action="open-upload">上传项目资料</button>' : '<span class="yd-readonly">' + (config.isLoggedIn ? '登录浏览' : '共享浏览') + '</span>') + '</nav></header>';
  }
  function render() {
    root.className = 'yd-app';
    root.innerHTML = header() + '<main class="yd-main"><div class="yd-notice" data-notice role="status"' + (!state.notice ? ' hidden' : '') + '>' + esc(state.notice) + receiptLink() + '</div>' + (state.loading ? '<div class="yd-empty" role="status"><span class="yd-spinner" aria-hidden="true"></span><h2>正在读取项目资料…</h2></div>' : state.project ? renderDetail() : renderList()) + '</main>' + (canUpload ? renderUpload() : '');
    bindModels();
    bindImagePreviews();
    root.querySelectorAll('[data-version], [data-image-role], [data-action="set-current"], [data-cover-id], [data-access-visibility], [data-action="save-access"]').forEach(function (el) { if (state.configuring || state.uploading) el.disabled = true; });
  }
  function bindModels() {
    root.querySelectorAll('model-viewer').forEach(function (viewer) {
      viewer.addEventListener('error', function () { var status = viewer.parentNode.querySelector('[data-model-status]'); if (status) { status.textContent = '模型预览暂时无法加载，请下载文件查看。'; status.hidden = false; } });
      viewer.addEventListener('load', function () { var status = viewer.parentNode.querySelector('[data-model-status]'); if (status) status.hidden = true; });
    });
  }
  function renderContent() {
    root.querySelector('.yd-main').innerHTML = '<div class="yd-notice" data-notice role="status"' + (!state.notice ? ' hidden' : '') + '>' + esc(state.notice) + receiptLink() + '</div>' + renderDetail();
    bindModels();
    bindImagePreviews();
    root.querySelectorAll('[data-version], [data-image-role], [data-action="set-current"], [data-cover-id], [data-access-visibility], [data-action="save-access"]').forEach(function (el) { if (state.configuring || state.uploading) el.disabled = true; });
  }
  function renderList() {
    var regions = Array.from(new Set(state.projects.map(function (p) { return p.region || '未分类'; })));
    return '<section class="yd-intro"><div><p class="yd-eyebrow">项目 · 设计 · 资料</p><h1>让每一版设计，都有迹可循</h1><p>现场原貌、方案效果、三维模型与图纸，按项目和版本集中查看。</p></div><div class="yd-summary"><strong>' + state.projects.length + '</strong><span>个项目</span></div></section>' +
      '<section aria-label="项目库"><div class="yd-toolbar"><h2>项目资料</h2><div class="yd-filters"><label class="yd-search"><span class="yd-sr-only">搜索项目</span><input type="search" data-search placeholder="搜索项目名称或区域"></label><label><span class="yd-sr-only">筛选区域</span><select data-region><option value="">全部区域</option>' + regions.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join('') + '</select></label></div></div><div class="yd-project-grid">' + state.projects.map(function (p) {
        var v = defaultVersion(p), cover = projectCover(p);
        return '<a class="yd-project-card" href="' + esc(pageLink(p.id)) + '" data-project-card data-search-text="' + esc((p.title || '') + ' ' + (p.region || '未分类')) + '" data-project-region="' + esc(p.region || '未分类') + '"><div class="yd-project-cover">' + (cover ? imagePreview(cover, (p.title || '') + ' 项目预览') : '<span class="yd-cover-placeholder" aria-hidden="true">图纸 / 影像 / 模型</span>') + '<span class="yd-region-badge">' + esc(p.region || '未分类') + '</span></div><div class="yd-card-body"><h3>' + esc(p.title || '未命名项目') + '</h3><div class="yd-card-meta"><span>' + versions(p).length + ' 个版本</span><span>' + (v ? esc(v.label || '未命名版本') : '暂无资料') + '</span></div><p>' + (v ? '更新于 ' + esc(date(v.created_at)) : '等待首版资料') + '<span aria-hidden="true">↗</span></p></div></a>';
      }).join('') + '</div><div class="yd-empty" data-no-projects' + (state.projects.length ? ' hidden' : '') + '><h3>暂无项目资料</h3><p>' + (canUpload ? '上传首个项目，将现场与设计方案整理在一起。' : '管理员上传后，资料会显示在这里。') + '</p></div><div class="yd-empty" data-no-matches hidden><h3>没有找到匹配的项目</h3><p>请尝试其他关键词或区域。</p></div></section>';
  }
  function download(asset, label) {
    var url = safeUrl(asset.url); return url ? '<a class="yd-download" href="' + esc(url) + '" download target="_blank" rel="noopener">' + esc(label || '下载文件') + '<span aria-hidden="true"> ↓</span></a>' : '<span class="yd-file-unavailable">文件地址不可用</span>';
  }
  function receiptLink() {
    return state.savedReceipt ? ' <a class="yd-saved-link" href="' + esc(pageLink(state.savedReceipt.project_id, state.savedReceipt.version_id)) + '">打开已保存版本 ↗</a>' : '';
  }
  function categoryLink(item, section, role, label) {
    return '<a href="' + esc(pageLink(state.project.id, item.version.id, section, role)) + '" data-jump-version="' + esc(item.version.id) + '" data-jump-section="' + esc(section) + '"' + (role ? ' data-jump-role="' + esc(role) + '"' : '') + '><span>' + esc(label || item.asset.name || '未命名文件') + '</span><small>' + esc(item.version.label || '未命名版本') + (item.asset.kind === 'image' ? ' · ' + (item.asset.role === 'source' ? '原始现场' : '效果图') : '') + '</small></a>';
  }
  function renderProjectResources() {
    var p = state.project, items = projectAssets(p), kinds = function (kind) { return items.filter(function (i) { return i.asset.kind === kind; }); };
    var images = kinds('image'), models = kinds('model'), pdfs = kinds('pdf'), cads = kinds('cad'), docs = kinds('document');
    var groups = [
      { label: '效果 / 现场', entries: images, section: 'yd-images' },
      { label: '配色卡', match: /配色|色卡|色板|色彩|颜色|色号|palette|colou?r/i },
      { label: '材质资料', match: /材质|材料|面料|material|texture/i },
      { label: '日景 / 夜景', match: /日景|夜景|日夜|日间|夜间|白天|夜晚|\bday(?:light|time)?\b|\bnight\b/i },
      { label: '测量建议', match: /测量|测绘|尺寸建议|measurement|survey/i },
      { label: 'PDF / CAD', entries: pdfs.concat(cads), section: 'yd-pdfs' },
      { label: '说明文件', entries: docs, section: 'yd-documents' }
    ];
    var navigation = groups.map(function (group) {
      var entries = group.entries || items.filter(function (i) { return group.match.test((i.version.label || '') + ' ' + (i.asset.name || '')); });
      return '<details class="yd-resource-group"><summary>' + group.label + '<span>' + entries.length + '</span></summary>' + (entries.length ? '<div class="yd-resource-links">' + entries.map(function (item) {
        var section = group.section || (item.asset.kind === 'image' ? 'yd-images' : item.asset.kind === 'model' ? 'yd-project-models' : item.asset.kind === 'pdf' ? 'yd-pdfs' : item.asset.kind === 'cad' ? 'yd-cads' : 'yd-documents');
        if (group.label === 'PDF / CAD' && item.asset.kind === 'cad') section = 'yd-cads';
        return categoryLink(item, section, item.asset.kind === 'image' ? (item.asset.role === 'source' ? 'source' : 'effect') : '');
      }).join('') + '</div>' : '<p class="yd-resource-empty">暂无明确命名的资料</p>') + '</details>';
    }).join('');
    var interactive = (Array.isArray(p.interactive_models) ? p.interactive_models : []).map(function (entry) {
      var url = safeUrl(entry.url, new URL('.', apiUrl)), version = versions(p).find(function (v) { return String(v.id) === String(entry.version_id); });
      return '<article class="yd-interactive-card"><span class="yd-model-tag">完整互动模型</span><h3>' + esc(entry.label || entry.key || '互动模型') + '</h3><p>' + esc(version ? version.label : '项目资料') + '</p>' + (url ? '<a class="yd-button yd-primary" href="' + esc(url) + '" target="_blank" rel="noopener">打开完整互动模型 ↗</a>' : '<span class="yd-file-unavailable">入口地址不可用</span>') + '</article>';
    }).join('');
    var modelCards = models.map(function (item) { var a = item.asset, url = safeUrl(a.url); return '<article class="yd-model-card"><div class="yd-file-heading"><div><h3>' + esc(a.name) + '</h3><p class="yd-meta">' + esc(item.version.label || '未命名版本') + ' · GLB 文件</p></div>' + download(a) + '</div>' + (url ? '<model-viewer src="' + esc(url) + '" alt="' + esc(a.name) + ' 三维模型" camera-controls touch-action="pan-y" interaction-prompt="auto"><span slot="poster" class="yd-model-poster">三维模型加载中…</span></model-viewer><p class="yd-preview-status" data-model-status>拖动旋转 · 滚轮或双指缩放；完整功能请使用上方互动入口。</p>' : '<div class="yd-empty">模型地址不可用</div>') + '</article>'; }).join('');
    return '<section class="yd-project-resources" aria-label="全项目资料"><div class="yd-section-heading"><h2>项目全部资料</h2><p>' + versions(p).length + ' 个版本 · ' + items.length + ' 个文件</p></div><p class="yd-project-totals">影像 ' + images.length + ' · 三维模型 ' + models.length + ' · PDF ' + pdfs.length + ' · CAD ' + cads.length + ' · 说明文件 ' + docs.length + '</p><nav class="yd-resource-nav" aria-label="全版本分类资料"><a class="yd-model-shortcut" href="#yd-project-models">三维模型 <strong>' + models.length + '</strong> · 完整互动入口 ' + (Array.isArray(p.interactive_models) ? p.interactive_models.length : 0) + '</a>' + navigation + '</nav></section><section class="yd-section" id="yd-project-models"><div class="yd-section-heading"><h2>三维模型 · 全部版本</h2><p>完整互动入口优先 · GLB 按版本保留</p></div>' + (interactive ? '<div class="yd-interactive-grid">' + interactive + '</div>' : '') + (modelCards ? '<div class="yd-model-grid">' + modelCards + '</div>' : (!interactive ? '<p class="yd-resource-empty">此项目暂无三维模型。</p>' : '')) + '</section>';
  }
  function renderAccess() {
    if (!canUpload) return '';
    var p = state.project, saved = p.visibility || 'public', selected = accessDrafts[p.id] || saved;
    return '<section class="yd-access-panel" aria-label="项目访问权限"><div><h2>项目访问权限</h2><p>已保存：<strong data-access-saved>' + (saved === 'login' ? '需登录' : '公开') + '</strong>。需登录的项目允许所有已登录账号查看，上传和修改仍由管理员操作。</p></div><div class="yd-access-controls"><label>访问范围<select data-access-visibility><option value="public"' + (selected === 'public' ? ' selected' : '') + '>公开 · 不用登录</option><option value="login"' + (selected === 'login' ? ' selected' : '') + '>需登录 · 登录后查看</option></select></label><button type="button" class="yd-button yd-primary" data-action="save-access"' + (state.configuring || state.uploading ? ' disabled' : '') + '>保存权限</button></div></section>';
  }
  function renderDetail() {
    var p = state.project, v = activeVersion(), all = assets(v), imgs = all.filter(function (a) { return a.kind === 'image'; });
    var visible = imgs.filter(function (a) { return a.role === state.imageRole || (!['source', 'effect'].includes(a.role) && state.imageRole === 'effect'); });
    var pdfs = all.filter(function (a) { return a.kind === 'pdf'; }), cads = all.filter(function (a) { return a.kind === 'cad'; }), documents = all.filter(function (a) { return a.kind === 'document'; });
    return '<a class="yd-back" href="' + esc(pageLink()) + '">← 返回项目库</a><section class="yd-detail-heading"><div><p class="yd-eyebrow">' + esc(p.region || '未分类') + '</p><h1>' + esc(p.title || '未命名项目') + '</h1><p>按版本查看现场、效果、模型和图纸。</p></div>' + (canUpload ? '<button type="button" class="yd-button yd-primary" data-action="open-upload">上传新版本</button>' : '') + '</section>' + renderAccess() + renderProjectResources() + renderComparison() + '<section class="yd-version-panel" aria-label="项目版本"><label>当前版本<select data-version>' + versions(p).map(function (item) { return '<option value="' + esc(item.id) + '"' + (v && String(item.id) === String(v.id) ? ' selected' : '') + '>' + esc(item.label || '未命名版本') + (String(item.id) === String((defaultVersion(p) || {}).id) ? ' · 默认' : '') + ' · ' + esc(date(item.created_at)) + '</option>'; }).join('') + '</select></label><div><span class="yd-meta">' + (v ? '保存于 ' + esc(date(v.created_at)) + ' · ' + all.length + ' 个文件' : '暂无版本') + '</span><p class="yd-description">' + esc(v && v.description || '此版本未填写说明。') + '</p><div class="yd-version-actions"><button type="button" class="yd-button" data-action="copy-version">复制当前版本链接</button>' + (canUpload && v ? '<button type="button" class="yd-button" data-action="set-current"' + (state.configuring || String(p.current_version_id) === String(v.id) ? ' disabled' : '') + '>' + (String(p.current_version_id) === String(v.id) ? '已设为默认版本' : '设此版本为默认') + '</button>' : '') + '</div></div></section><div class="yd-section-heading yd-current-heading"><h2>版本详情</h2><p>' + esc(v && v.label || '') + '</p></div>' +
      (imgs.length ? '<section class="yd-section" id="yd-images"><div class="yd-section-heading"><h2>项目影像</h2><div class="yd-tabs" role="group" aria-label="影像类型"><button type="button" data-image-role="effect" aria-pressed="' + (state.imageRole === 'effect') + '">效果图 <span>' + imgs.filter(function (a) { return a.role !== 'source'; }).length + '</span></button><button type="button" data-image-role="source" aria-pressed="' + (state.imageRole === 'source') + '">原始现场 <span>' + imgs.filter(function (a) { return a.role === 'source'; }).length + '</span></button></div></div><div class="yd-image-grid">' + visible.map(function (a) { var url = safeUrl(a.url); return '<figure class="yd-image-card">' + (url ? '<button type="button" data-image-id="' + esc(a.id) + '" aria-label="放大查看 ' + esc(a.name) + '">' + imagePreview(a) + '<span class="yd-image-hint">放大查看 ↗</span></button>' : '<div class="yd-empty">图片地址不可用</div>') + '<figcaption><span title="' + esc(imageTitle(a)) + '">' + esc(imageTitle(a)) + '</span>' + (a.caption ? '<small class="yd-original-name">原文件：' + esc(a.name) + '</small>' : '') + '<span class="yd-image-role">' + imageRole(a) + '</span>' + download(a, '原图') + (canUpload ? '<button type="button" class="yd-cover-action" data-cover-id="' + esc(a.id) + '"' + (state.configuring || String(p.cover_asset_id) === String(a.id) ? ' disabled' : '') + '>' + (String(p.cover_asset_id) === String(a.id) ? '当前封面' : '设为封面') + '</button>' : '') + '</figcaption>' + renderCaptionEditor(a) + '</figure>'; }).join('') + '</div>' + (!visible.length ? '<div class="yd-empty">此版本没有' + (state.imageRole === 'source' ? '原始现场图片' : '效果图') + '。</div>' : '') + '</section>' : '') +
      (pdfs.length ? '<section class="yd-section" id="yd-pdfs"><div class="yd-section-heading"><h2>方案文档</h2><p>同页阅读与文件下载</p></div>' + pdfs.map(function (a) { var url = safeUrl(a.url); return '<article class="yd-pdf-card"><div class="yd-file-heading"><h3>' + esc(a.name) + '</h3>' + download(a) + '</div>' + (url ? '<iframe src="' + esc(url) + '" title="' + esc(a.name) + ' PDF 预览" loading="lazy"></iframe><p class="yd-preview-status">如果浏览器未显示 PDF，请点击上方下载文件。</p>' : '<div class="yd-empty">文档地址不可用</div>') + '</article>'; }).join('') + '</section>' : '') +
      (cads.length ? '<section class="yd-section" id="yd-cads"><div class="yd-section-heading"><h2>CAD 图纸</h2><p>下载后使用 CAD 软件查看</p></div><ul class="yd-file-list">' + cads.map(function (a) { return '<li><span class="yd-file-icon" aria-hidden="true">CAD</span><div><strong>' + esc(a.name) + '</strong><span>' + esc(bytes(a.bytes)) + '</span></div>' + download(a, '下载图纸') + '</li>'; }).join('') + '</ul></section>' : '') + (documents.length ? '<section class="yd-section" id="yd-documents"><div class="yd-section-heading"><h2>配色与说明文件</h2><p>下载原始表格与文字说明</p></div><ul class="yd-file-list">' + documents.map(function (a) { return '<li><span class="yd-file-icon" aria-hidden="true">FILE</span><div><strong>' + esc(a.name) + '</strong><span>' + esc(bytes(a.bytes)) + '</span></div>' + download(a) + '</li>'; }).join('') + '</ul></section>' : '') + (!all.length ? '<div class="yd-empty"><h3>此版本暂无文件</h3><p>' + (canUpload ? '通过上传项目资料添加首版内容。' : '请等待管理员上传资料。') + '</p></div>' : '');
  }
  function renderCaptionEditor(asset) {
    if (!canUpload) return '';
    var key = captionDraftKey(state.project.id, asset.id), draft = captionDrafts[key], value = draft ? draft.value : asset.caption || '', busy = state.configuring || state.uploading;
    return '<details class="yd-caption-editor"' + (draft ? ' open' : '') + '><summary>编辑图片说明</summary><label>展示标题 / 说明（可选）<input data-caption-id="' + esc(asset.id) + '" data-codepoint-limit="240" value="' + esc(value) + '"' + (busy ? ' disabled' : '') + ' placeholder="例如：同版夜景 · 入口灯光"><small data-character-count>' + Array.from(value).length + ' / 240 字符</small></label><button type="button" class="yd-button" data-action="save-caption" data-caption-save="' + esc(asset.id) + '"' + (busy ? ' disabled' : '') + '>保存说明</button><small>留空可删除说明；原文件名保留。</small></details>';
  }
  function captionDraftKey(projectId, assetId) { return JSON.stringify([String(projectId), String(assetId)]); }
  function captureCaptionDraft(input) { if (state.project && input.dataset.captionId) captionDrafts[captionDraftKey(state.project.id, input.dataset.captionId)] = { value: input.value }; }
  function comparisonItem(side) { return projectAssets(state.project).find(function (item) { return item.asset.kind === 'image' && String(item.asset.id) === compareSelection[side] && safeUrl(item.asset.url); }); }
  function comparisonLabel(item) { return (item.version.label || '未命名版本') + ' · ' + imageRole(item.asset) + ' · ' + imageTitle(item.asset); }
  function comparisonPanel(side) {
    var item = comparisonItem(side);
    if (!item) return '<div class="yd-compare-empty">请选择' + (side ? '右侧' : '左侧') + '图片</div>';
    var asset = item.asset;
    return '<figure class="yd-compare-card"><button type="button" data-compare-image="' + side + '" aria-label="放大查看 ' + esc(comparisonLabel(item)) + '">' + imagePreview(asset) + '<span class="yd-image-hint">放大原图 ↗</span></button><figcaption><strong>' + esc(imageTitle(asset)) + '</strong><span>' + esc(item.version.label || '未命名版本') + ' · ' + imageRole(asset) + '</span><small>原文件：' + esc(asset.name) + '</small>' + (item.version.description ? '<p>' + esc(item.version.description) + '</p>' : '') + download(asset, '下载原图') + '</figcaption></figure>';
  }
  function renderComparison() {
    var imageItems = projectAssets(state.project).filter(function (item) { return item.asset.kind === 'image' && safeUrl(item.asset.url); });
    if (imageItems.length < 2) return '';
    return '<section class="yd-section yd-comparison" id="yd-comparison" aria-label="双图比较"><div class="yd-section-heading"><h2>双图比较</h2><p>从本项目任意版本选择图片，可对照日夜、两版方案或现场与效果。</p></div><div class="yd-compare-grid">' + [0, 1].map(function (side) {
      return '<div class="yd-compare-side"><label>' + (side ? '右侧图片' : '左侧图片') + '<select data-compare-select="' + side + '"><option value="">请选择图片</option>' + versions(state.project).map(function (version) { var entries = imageItems.filter(function (item) { return item.version === version; }); return entries.length ? '<optgroup label="' + esc(version.label || '未命名版本') + '">' + entries.map(function (item) { return '<option value="' + esc(item.asset.id) + '"' + (String(item.asset.id) === compareSelection[side] ? ' selected' : '') + '>' + esc(imageRole(item.asset) + ' · ' + imageTitle(item.asset) + (item.asset.caption ? ' · ' + item.asset.name : '')) + '</option>'; }).join('') + '</optgroup>' : ''; }).join('') + '</select></label><div data-compare-panel="' + side + '">' + comparisonPanel(side) + '</div></div>';
    }).join('') + '</div></section>';
  }
  function renderComparisonPanels() { root.querySelectorAll('[data-compare-panel]').forEach(function (panel) { panel.innerHTML = comparisonPanel(Number(panel.dataset.comparePanel)); }); bindImagePreviews(); }
  function saveCaption(button) {
    if (!state.project || state.configuring || state.uploading) return;
    var input = root.querySelector('[data-caption-id="' + CSS.escape(button.dataset.captionSave) + '"]');
    if (!input) return;
    captureCaptionDraft(input);
    if (validateCharacters(input) || !input.reportValidity()) return;
    var key = captionDraftKey(state.project.id, button.dataset.captionSave), sent = input.value;
    var captions = {}; captions[button.dataset.captionSave] = input.value;
    configureProject({ captions: JSON.stringify(captions) }, '图片说明已保存。', 'yudaoDesign.projects.annotate', function () { if (captionDrafts[key] && captionDrafts[key].value === sent) delete captionDrafts[key]; });
  }
  function renderUpload() {
    return '<section class="yd-upload-panel" data-upload-panel' + (!state.uploadOpen ? ' hidden' : '') + ' aria-labelledby="yd-upload-title"><div class="yd-upload-inner"><div class="yd-section-heading"><div><p class="yd-eyebrow">统一资料上传</p><h2 id="yd-upload-title">上传项目资料</h2></div><button type="button" class="yd-close" data-action="close-upload" aria-label="关闭上传面板">×</button></div><p class="yd-upload-lead">一次提交一个版本，图片、模型、PDF 和 CAD 图纸可一起上传。</p><form data-upload-form><div class="yd-form-grid"><label class="yd-field yd-field-wide">归属项目<select name="project_id" data-upload-project><option value="">新建项目</option>' + state.projects.map(function (p) { return '<option value="' + esc(p.id) + '"' + (state.project && state.project.id === p.id ? ' selected' : '') + '>' + esc(p.title) + '</option>'; }).join('') + '</select></label><label class="yd-field">项目名称<input name="title" required maxlength="160" value="' + esc(state.project && state.project.title || '') + '"' + (state.project ? ' readonly' : '') + ' placeholder="例如：室外温泉景观改造"></label><label class="yd-field">所属区域<input name="region" maxlength="160" value="' + esc(state.project && state.project.region || '') + '"' + (state.project ? ' readonly' : '') + ' placeholder="例如：温泉区"></label><label class="yd-field yd-field-wide">版本名称<input name="version" required maxlength="100" placeholder="例如：R03 · 方案汇报"></label><label class="yd-field yd-field-wide">版本说明<textarea name="description" rows="3" data-codepoint-limit="' + descriptionLimit() + '" placeholder="记录本版内容、调整范围或待确认事项"></textarea><small data-character-count>0 / ' + descriptionLimit() + ' 字符</small></label></div><label class="yd-dropzone"><span class="yd-drop-icon" aria-hidden="true">↑</span><strong>选择或拖入本版文件</strong><span>图片、GLB、PDF、DWG / DXF、CSV / TXT</span><input type="file" name="files[]" multiple required accept=".jpg,.jpeg,.png,.webp,.glb,.pdf,.dwg,.dxf,.csv,.txt" data-files></label><p class="yd-upload-limits">' + esc(limitText()) + '</p><div data-file-selection aria-live="polite"></div><div class="yd-upload-status" data-upload-status role="status" hidden><progress max="100" value="0"></progress><p></p></div><div class="yd-upload-actions"><span>服务器确认保存成功后，才会更新项目资料。</span><button type="button" class="yd-button" data-action="cancel-upload" hidden>取消上传</button><button type="submit" class="yd-button yd-primary">保存此版本</button></div></form></div></section>';
  }
  async function load() {
    state.detailRevision++; state.loading = true; render();
    try {
      var id = new URL(window.location.href).searchParams.get('project');
      var list = await get('yudaoDesign.projects.list');
      if (!Array.isArray(list.projects)) throw new Error('项目列表格式不正确。');
      state.projects = list.projects; state.limits = list.limits || state.limits;
      if (id) { var detail = await get('yudaoDesign.projects.get', { project_id: id }); if (!detail.project) throw new Error('未找到该项目。'); state.project = detail.project; state.limits = detail.limits || state.limits; var requested = new URL(window.location.href).searchParams.get('version'); var chosen = versions(state.project).find(function (v) { return String(v.id) === requested; }) || defaultVersion(state.project); state.version = String((chosen || {}).id || ''); chooseImageRole(activeVersion()); var role = new URL(window.location.href).searchParams.get('role'); if (role === 'source' || role === 'effect') state.imageRole = role; if (requested && (!chosen || String(chosen.id) !== requested)) state.notice = '链接中的版本不存在，已显示项目默认版本。'; }
      state.loading = false; render(); if (state.project && /^#yd-(images|project-models|pdfs|cads|documents)$/.test(window.location.hash)) focusSection(window.location.hash.slice(1));
    } catch (error) { state.loading = false; state.project = null; render(); notice(error.message || '项目资料加载失败。', true); }
  }
  function filterProjects() {
    var query = (root.querySelector('[data-search]').value || '').trim().toLocaleLowerCase(), region = root.querySelector('[data-region]').value, count = 0;
    root.querySelectorAll('[data-project-card]').forEach(function (card) { var match = card.dataset.searchText.toLocaleLowerCase().includes(query) && (!region || card.dataset.projectRegion === region); card.hidden = !match; if (match) count++; });
    root.querySelector('[data-no-matches]').hidden = count > 0 || !state.projects.length;
  }
  function limitText() {
    var limits = state.limits, text = [];
    if (limits.max_files > 0) text.push('单次最多 ' + limits.max_files + ' 个文件');
    var groups = [{ label: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }, { label: 'GLB / PDF / CAD', extensions: ['glb', 'pdf', 'dwg', 'dxf'] }, { label: 'CSV / TXT', extensions: ['csv', 'txt'] }];
    groups.forEach(function (group) { var values = group.extensions.map(fileLimit).filter(function (n) { return n > 0; }); if (values.length) text.push(group.label + ' 每个不超过 ' + bytes(Math.min.apply(null, values))); });
    if (limits.max_total_bytes > 0) text.push('本次总容量不超过 ' + bytes(limits.max_total_bytes));
    return text.join(' · ');
  }
  function fileLimit(extension) { var specific = Number((state.limits.per_extension_bytes || {})[extension]); return specific > 0 ? specific : Number(state.limits.max_file_bytes || 0); }
  function descriptionLimit() { return Number(state.limits.description_max_chars) > 0 ? Number(state.limits.description_max_chars) : 5000; }
  function validateCharacters(input) {
    if (!input) return '';
    var max = Number(input.dataset.codepointLimit), length = Array.from(input.name === 'description' ? input.value.trim() : input.value).length;
    var message = max > 0 && length > max ? (input.name === 'description' ? '版本说明' : '图片说明') + '最多 ' + max + ' 个字符（当前 ' + length + ' 个）。' : '';
    input.setCustomValidity(message);
    var count = input.parentNode.querySelector('[data-character-count]'); if (count) { count.textContent = length + ' / ' + max + ' 字符'; count.classList.toggle('yd-character-error', !!message); }
    return message;
  }
  function validateFiles() {
    var limits = state.limits, names = new Set(), total = 0;
    if (limits.max_files > 0 && state.files.length > limits.max_files) return '单次最多上传 ' + limits.max_files + ' 个文件，请重新选择。';
    for (var i = 0; i < state.files.length; i++) {
      var file = state.files[i].file; total += file.size;
      if (!/\.(jpe?g|png|webp|glb|pdf|dwg|dxf|csv|txt)$/i.test(file.name)) return file.name + ' 格式暂不支持，请选择 JPG、PNG、WebP、GLB、PDF、DWG、DXF、CSV 或 TXT。';
      if (names.has(file.name)) return '所选文件存在同名文件，请重命名后重新选择。';
      names.add(file.name);
      if (!file.size) return file.name + ' 是空文件，请检查后重新选择。';
      var extension = file.name.split('.').pop().toLowerCase(), maximum = fileLimit(extension);
      if (maximum > 0 && file.size > maximum) return file.name + ' 超过 ' + extension.toUpperCase() + ' 单文件限制（' + bytes(maximum) + '）。';
    }
    if (limits.max_total_bytes > 0 && total > limits.max_total_bytes) return '总容量超过本次上传限制（' + bytes(limits.max_total_bytes) + '），请减少文件。';
    return '';
  }
  function selectFiles(files) {
    state.files = Array.from(files || []).map(function (file) { return { file: file, role: 'source' }; });
    var target = root.querySelector('[data-file-selection]');
    target.innerHTML = state.files.length ? '<p class="yd-selection-summary">已选择 ' + state.files.length + ' 个文件 · ' + esc(bytes(state.files.reduce(function (sum, item) { return sum + item.file.size; }, 0))) + '</p><ul class="yd-selected-files">' + state.files.map(function (item, index) {
      var image = /\.(jpe?g|png|webp)$/i.test(item.file.name);
      var maximum = fileLimit(item.file.name.split('.').pop().toLowerCase());
      return '<li><div><strong>' + esc(item.file.name) + '</strong><span>' + esc(bytes(item.file.size)) + (maximum > 0 ? ' · 此类型上限 ' + esc(bytes(maximum)) : '') + '</span></div>' + (image ? '<label><span class="yd-sr-only">' + esc(item.file.name) + ' 的图片类型</span><select data-file-role="' + index + '"><option value="source">原始现场</option><option value="effect">效果图</option></select></label>' : '<span class="yd-file-type">' + (/\.(glb)$/i.test(item.file.name) ? '三维模型' : /\.pdf$/i.test(item.file.name) ? '方案文档' : 'CAD / 文件') + '</span>') + '</li>';
    }).join('') + '</ul>' : '';
  }
  function uploadStatus(message, progress, error) {
    var node = root.querySelector('[data-upload-status]'); node.hidden = false; node.classList.toggle('yd-error', !!error); node.setAttribute('role', error ? 'alert' : 'status'); node.querySelector('p').textContent = message;
    var bar = node.querySelector('progress'); if (progress == null) bar.removeAttribute('value'); else bar.value = progress;
  }
  function uploadBusy(busy) {
    state.uploading = busy;
    root.querySelectorAll('[data-version], [data-image-role]').forEach(function (el) { el.disabled = busy; });
    root.querySelector('[data-upload-form]').querySelectorAll('input, select, textarea, button[type="submit"]').forEach(function (el) { el.disabled = busy; });
    root.querySelector('[data-action="cancel-upload"]').hidden = !busy;
    root.querySelector('[data-action="close-upload"]').disabled = busy;
    root.querySelector('[data-upload-form] button[type="submit"]').textContent = busy ? '正在保存…' : '保存此版本';
  }
  async function copyVersionLink() {
    var link = pageLink(state.project.id, state.version), copied = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(link); copied = true; } } catch (error) {}
    if (!copied) {
      var field = document.createElement('textarea'), focused = document.activeElement;
      field.value = link; field.setAttribute('aria-label', '当前版本链接'); field.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(field); field.select();
      try { copied = document.execCommand('copy'); } catch (error) {}
      field.remove(); if (focused && focused.isConnected) focused.focus({ preventScroll: true });
    }
    notice(copied ? '当前版本链接已复制。' : '复制失败，请手动复制：' + link, !copied);
  }
  async function configureProject(changes, successMessage, method, onConfirmed) {
    if (!canUpload || state.configuring || state.uploading || !state.project) return;
    state.detailRevision++;
    var projectId = String(state.project.id), confirmed = false, revision = state.detailRevision;
    state.configurationRevision = revision;
    function isCurrent() { return state.detailRevision === revision && state.project && String(state.project.id) === projectId; }
    function finish() { if (state.configurationRevision === revision) state.configuring = false; }
    state.configuring = true; notice('正在保存项目设置…', false);
    try {
      renderContent();
      var data = new FormData(); data.append('project_id', projectId); data.append('pwg_token', config.token || '');
      Object.keys(changes).forEach(function (key) { data.append(key, changes[key]); });
      var response = await fetch(endpoint(method || 'yudaoDesign.projects.configure'), { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json' }, body: data });
      var body; try { body = await response.json(); } catch (error) { throw new Error('设置保存响应无法读取，请刷新核对。'); }
      if (!response.ok) throw new Error(body.message || body.error || '设置保存失败（HTTP ' + response.status + '）。');
      var result = responseResult(body);
      confirmed = method === 'yudaoDesign.projects.annotate' ? result.saved === true && String(result.project_id) === projectId : !!(result.project && String(result.project.id) === projectId) || (result.saved === true && String(result.project_id) === projectId);
      if (!confirmed) throw new Error('服务器未确认项目设置，请刷新核对。');
      if (onConfirmed) onConfirmed();
      if (!isCurrent()) { finish(); return; }
      state.notice = successMessage + (result.warning ? ' ' + result.warning : '');
      if (result.project) { state.project = result.project; updateProjectList(result.project); }
      else {
        notice(state.notice + ' 正在重新读取详情…', false);
        var fresh = await get('yudaoDesign.projects.get', { project_id: projectId });
        if (!fresh.project) throw new Error('项目详情不可用。');
        if (!isCurrent()) { finish(); return; }
        state.project = fresh.project; updateProjectList(fresh.project);
      }
      finish(); renderContent();
    } catch (error) {
      finish(); if (!isCurrent()) return;
      var message = confirmed ? successMessage + ' 详情加载失败：' + (error.message || '请刷新核对项目设置。') : (error.message || '项目设置保存失败。');
      state.notice = message;
      try { renderContent(); } catch (renderError) {}
      notice(message, !confirmed);
    }
  }
  function updateProjectList(project) {
    var index = state.projects.findIndex(function (p) { return String(p.id) === String(project.id); });
    if (index >= 0) state.projects[index] = project; else state.projects.unshift(project);
  }
  function requestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var values = new Uint8Array(16); window.crypto.getRandomValues(values); values[6] = (values[6] & 15) | 64; values[8] = (values[8] & 63) | 128;
    return Array.from(values).map(function (v, i) { return ([4, 6, 8, 10].includes(i) ? '-' : '') + v.toString(16).padStart(2, '0'); }).join('');
  }
  async function acceptSavedUpload(result) {
    var project = result.project, committed = result.saved === true && result.project_id && result.version_id;
    // Older servers return only project; newer servers expose the durable commit receipt.
    if (!committed && (!project || !project.id)) throw new Error('服务器未确认保存项目，请核查后重试。');
    var projectId = String(committed ? result.project_id : project.id), versionId = String(committed ? result.version_id : (latest(project) || {}).id || '');
    state.savedReceipt = { project_id: projectId, version_id: versionId };
    state.files = []; state.uploading = false; state.xhr = null; state.uploadOpen = false; state.requestId = ''; state.requestSignature = '';
    state.notice = '版本已保存。' + (result.warning ? ' ' + result.warning : '');
    state.project = project || null; if (project) updateProjectList(project);
    state.version = versionId; chooseImageRole(activeVersion());
    window.history.replaceState(null, '', pageLink(projectId, versionId)); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    var refreshRevision = state.detailRevision;
    function refreshIsCurrent() { return state.detailRevision === refreshRevision && state.savedReceipt && state.savedReceipt.project_id === projectId && state.savedReceipt.version_id === versionId && !state.uploading; }
    try {
      var fresh = await get('yudaoDesign.projects.get', { project_id: projectId }); if (!fresh.project) throw new Error('项目详情不可用。');
      if (refreshIsCurrent()) { state.project = fresh.project; updateProjectList(fresh.project); state.version = versionId; chooseImageRole(activeVersion()); render(); }
    } catch (error) { if (refreshIsCurrent()) notice('版本已保存；详情加载失败：' + (error.message || '请稍后打开已保存版本。') + (result.warning ? ' ' + result.warning : ''), false); }
  }
  function submitUpload(form) {
    if (state.uploading || state.configuring) return;
    validateCharacters(form.elements.description); if (!form.reportValidity()) return;
    if (!state.files.length) { uploadStatus('请先选择至少一个文件。', 0, true); return; }
    var descriptionError = validateCharacters(form.elements.description); if (descriptionError) { uploadStatus(descriptionError, 0, true); return; }
    var fileError = validateFiles(); if (fileError) { uploadStatus(fileError, 0, true); return; }
    var signature = JSON.stringify(['title', 'region', 'version', 'description', 'project_id'].map(function (key) { return form.elements[key].value.trim(); }).concat(state.files.map(function (item) { return [item.file.name, item.file.size, item.file.lastModified, item.role]; })));
    if (!state.requestId || signature !== state.requestSignature) { state.requestId = requestId(); state.requestSignature = signature; }
    var data = new FormData();
    ['title', 'region', 'version', 'description', 'project_id'].forEach(function (key) { var value = form.elements[key].value.trim(); if (value || key !== 'project_id') data.append(key, value); });
    data.append('request_id', state.requestId); data.append('method', 'yudaoDesign.projects.import'); data.append('pwg_token', config.token || '');
    state.files.forEach(function (item) { data.append('files[]', item.file, item.file.name); });
    data.append('manifest', JSON.stringify(state.files.map(function (item) { return { name: item.file.name, role: /\.(jpe?g|png|webp)$/i.test(item.file.name) ? item.role : 'document' }; })));
    state.detailRevision++; state.savedReceipt = null; uploadBusy(true); uploadStatus('正在上传文件…', 0);
    var xhr = new XMLHttpRequest(); state.xhr = xhr;
    xhr.open('POST', endpoint('yudaoDesign.projects.import'), true); xhr.setRequestHeader('Accept', 'application/json');
    xhr.upload.addEventListener('progress', function (event) { var percent = event.lengthComputable ? Math.min(100, Math.round(event.loaded / event.total * 100)) : null; uploadStatus(percent === 100 ? '文件已传输，服务器正在校验并保存，请稍候…' : '正在上传文件' + (percent == null ? '…' : ' · ' + percent + '%'), percent === 100 ? null : percent); });
    xhr.addEventListener('load', async function () {
      try {
        if (xhr.status < 200 || xhr.status >= 300) {
          var failure; try { failure = JSON.parse(xhr.responseText); } catch (error) {}
          throw new Error(failure && (failure.message || failure.error) || (xhr.status === 413 ? '上传总容量超过服务器限制，请减少文件大小或数量。' : '上传失败（HTTP ' + xhr.status + '）。'));
        }
        var result; try { result = responseResult(JSON.parse(xhr.responseText)); } catch (error) { throw new Error(error.message || '服务器响应无法读取。'); }
        await acceptSavedUpload(result);
      } catch (error) {
        state.xhr = null;
        if (state.savedReceipt) { state.uploading = false; state.uploadOpen = false; notice('版本已保存；详情加载失败：' + (error.message || '请打开已保存版本。'), false); }
        else { uploadBusy(false); uploadStatus(error.message || '上传失败，请检查后重试。', 0, true); }
      }
    });
    xhr.addEventListener('error', function () { uploadBusy(false); state.xhr = null; uploadStatus('网络中断，尚未收到保存确认。请刷新核对项目版本后再重试。', 0, true); });
    xhr.addEventListener('abort', function () { uploadBusy(false); state.xhr = null; uploadStatus('上传已取消。若文件已传输，请刷新核对是否已保存。', 0, true); });
    xhr.send(data);
  }
  function openLightbox(id, images) {
    lightboxImages = images || assets(activeVersion()).filter(function (a) { return a.kind === 'image' && safeUrl(a.url) && (a.role === state.imageRole || (!['source', 'effect'].includes(a.role) && state.imageRole === 'effect')); });
    lightboxIndex = lightboxImages.findIndex(function (a) { return String(a.id) === id; }); if (lightboxIndex < 0) return;
    previousFocus = document.activeElement; lightbox = document.createElement('div'); lightbox.className = 'yd-lightbox'; lightbox.setAttribute('role', 'dialog'); lightbox.setAttribute('aria-modal', 'true'); lightbox.setAttribute('aria-label', '图片放大预览');
    lightbox.innerHTML = '<div class="yd-lightbox-toolbar"><strong data-lightbox-name></strong><div><button type="button" data-lightbox="out" aria-label="缩小">−</button><span data-zoom-value>100%</span><button type="button" data-lightbox="in" aria-label="放大">＋</button><button type="button" data-lightbox="reset">适应窗口</button><a data-lightbox-download download target="_blank" rel="noopener">下载原图 ↓</a><button type="button" data-lightbox="close" aria-label="关闭图片预览">×</button></div></div><div class="yd-lightbox-stage"><img alt=""></div><div class="yd-lightbox-footer"><button type="button" data-lightbox="previous">← 上一张</button><span data-image-counter></span><button type="button" data-lightbox="next">下一张 →</button></div>';
    document.body.appendChild(lightbox); lightbox.querySelector('img').addEventListener('load', function () { setZoom(zoom); }); document.body.classList.add('yd-modal-open'); updateLightbox(); lightbox.querySelector('[data-lightbox="close"]').focus();
    lightbox.addEventListener('click', function (event) { var button = event.target.closest('[data-lightbox]'); if (!button) return; var action = button.dataset.lightbox; if (action === 'close') closeLightbox(); else if (action === 'in') setZoom(zoom + 0.5); else if (action === 'out') setZoom(zoom - 0.5); else if (action === 'reset') setZoom(1); else { lightboxIndex = (lightboxIndex + (action === 'next' ? 1 : -1) + lightboxImages.length) % lightboxImages.length; updateLightbox(); } });
  }
  function updateLightbox() { var item = lightboxImages[lightboxIndex]; lightbox.querySelector('img').src = safeUrl(item.url); lightbox.querySelector('img').alt = imageTitle(item); lightbox.querySelector('[data-lightbox-name]').textContent = item.compareLabel || imageTitle(item); lightbox.querySelector('[data-lightbox-download]').href = safeUrl(item.url); lightbox.querySelector('[data-image-counter]').textContent = (lightboxIndex + 1) + ' / ' + lightboxImages.length; lightbox.querySelectorAll('[data-lightbox="next"], [data-lightbox="previous"]').forEach(function (button) { button.disabled = lightboxImages.length < 2; }); setZoom(1); }
  function setZoom(value) { zoom = Math.min(4, Math.max(1, value)); var stage = lightbox.querySelector('.yd-lightbox-stage'), image = stage.querySelector('img'), padding = window.innerWidth <= 680 ? 20 : 40; var fitWidth = Math.min(Math.max(1, stage.clientWidth - padding), image.naturalWidth || stage.clientWidth, Math.max(1, stage.clientHeight - padding) * (image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1)); image.style.width = zoom > 1 ? (fitWidth * zoom) + 'px' : ''; lightbox.style.setProperty('--yd-zoom', zoom); lightbox.classList.toggle('yd-is-zoomed', zoom > 1); lightbox.querySelector('[data-zoom-value]').textContent = Math.round(zoom * 100) + '%'; lightbox.querySelector('[data-lightbox="out"]').disabled = zoom === 1; lightbox.querySelector('[data-lightbox="in"]').disabled = zoom === 4; }
  function closeLightbox() { if (!lightbox) return; lightbox.remove(); lightbox = null; document.body.classList.remove('yd-modal-open'); if (previousFocus && previousFocus.isConnected) previousFocus.focus(); }
  document.addEventListener('keydown', function (event) {
    if (!lightbox) return;
    if (event.key === 'Escape') closeLightbox();
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { lightboxIndex = (lightboxIndex + (event.key === 'ArrowRight' ? 1 : -1) + lightboxImages.length) % lightboxImages.length; updateLightbox(); }
    else if (event.key === 'Tab') { var elements = Array.from(lightbox.querySelectorAll('button:not(:disabled), a[href]')), first = elements[0], last = elements[elements.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
  });
  root.addEventListener('click', function (event) {
    var action = event.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'save-access') {
        var accessProject = state.project && String(state.project.id), choice = root.querySelector('[data-access-visibility]');
        if (choice && accessProject) { var sentVisibility = choice.value; configureProject({ visibility: sentVisibility }, '项目权限已保存：' + (sentVisibility === 'login' ? '需登录。' : '公开。'), null, function () { if (accessDrafts[accessProject] === sentVisibility) delete accessDrafts[accessProject]; }); }
      }
      else if (action.dataset.action === 'set-current') configureProject({ current_version_id: state.version }, '默认版本已保存。');
      else if (action.dataset.action === 'save-caption') saveCaption(action);
      else if (action.dataset.action === 'copy-version') copyVersionLink();
      else if (action.dataset.action === 'open-upload') { if (state.uploading || state.configuring) return; state.detailRevision++; state.uploadOpen = true; var panel = root.querySelector('[data-upload-panel]'); panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); panel.querySelector('input[name="title"]').focus({ preventScroll: true }); }
      else if (action.dataset.action === 'close-upload' && !state.uploading) { state.uploadOpen = false; root.querySelector('[data-upload-panel]').hidden = true; root.querySelector('[data-action="open-upload"]').focus(); }
      else if (action.dataset.action === 'cancel-upload' && state.xhr) state.xhr.abort();
    }
    var cover = event.target.closest('[data-cover-id]'); if (cover) configureProject({ cover_asset_id: cover.dataset.coverId }, '项目封面已保存。');
    var jump = event.target.closest('[data-jump-version]'); if (jump && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { if (state.uploading || state.configuring) { event.preventDefault(); return; } event.preventDefault(); state.detailRevision++; state.version = jump.dataset.jumpVersion; chooseImageRole(activeVersion()); if (jump.dataset.jumpRole) state.imageRole = jump.dataset.jumpRole; syncVersionUrl(jump.dataset.jumpSection, jump.dataset.jumpRole); renderContent(); focusSection(jump.dataset.jumpSection); }
    var tab = event.target.closest('[data-image-role]'); if (tab && !state.uploading && !state.configuring) { state.detailRevision++; state.imageRole = tab.dataset.imageRole; syncVersionUrl('yd-images', state.imageRole); var scrollY = window.scrollY; renderContent(); window.scrollTo(0, scrollY); }
    var comparison = event.target.closest('[data-compare-image]'); if (comparison) { var item = comparisonItem(Number(comparison.dataset.compareImage)); if (item) openLightbox(String(item.asset.id), [Object.assign({}, item.asset, { compareLabel: comparisonLabel(item) })]); }
    var image = event.target.closest('[data-image-id]'); if (image) openLightbox(image.dataset.imageId);
  });
  root.addEventListener('change', function (event) {
    var target = event.target;
    if (target.matches('[data-compare-select]')) { compareSelection[Number(target.dataset.compareSelect)] = target.value; renderComparisonPanels(); }
    else if (target.matches('[data-access-visibility]') && state.project && !state.configuring && !state.uploading) { accessDrafts[state.project.id] = target.value; }
    else if (target.matches('[data-version]') && !state.uploading && !state.configuring) { state.detailRevision++; state.version = target.value; chooseImageRole(activeVersion()); syncVersionUrl(); renderContent(); }
    else if (target.matches('[data-region]')) filterProjects();
    else if (target.matches('[data-files]')) selectFiles(target.files);
    else if (target.matches('[data-file-role]') && state.files[Number(target.dataset.fileRole)]) state.files[Number(target.dataset.fileRole)].role = target.value;
    else if (target.matches('[data-upload-project]')) { var selected = state.projects.find(function (p) { return String(p.id) === target.value; }), form = root.querySelector('[data-upload-form]'); form.elements.title.value = selected ? selected.title || '' : ''; form.elements.region.value = selected ? selected.region || '' : ''; form.elements.title.readOnly = !!selected; form.elements.region.readOnly = !!selected; }
  });
  root.addEventListener('input', function (event) { if (event.target.matches('[data-search]')) filterProjects(); else if (event.target.matches('[data-codepoint-limit]')) { if (event.target.matches('[data-caption-id]')) captureCaptionDraft(event.target); validateCharacters(event.target); } });
  root.addEventListener('submit', function (event) { if (event.target.matches('[data-upload-form]')) { event.preventDefault(); submitUpload(event.target); } });
  root.addEventListener('dragover', function (event) { if (event.target.closest('.yd-dropzone') && !state.uploading) { event.preventDefault(); event.target.closest('.yd-dropzone').classList.add('yd-dragover'); } });
  root.addEventListener('dragleave', function (event) { var zone = event.target.closest('.yd-dropzone'); if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('yd-dragover'); });
  root.addEventListener('drop', function (event) { var zone = event.target.closest('.yd-dropzone'); if (!zone) return; event.preventDefault(); zone.classList.remove('yd-dragover'); if (!state.uploading && event.dataTransfer && event.dataTransfer.files.length) { var input = zone.querySelector('input'); input.files = event.dataTransfer.files; selectFiles(input.files); } });
  load();
}());
