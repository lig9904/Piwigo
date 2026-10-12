/* Render the design library without dependencies or external services. */
(function () {
  'use strict';
  var root = document.getElementById('yudao-design-app');
  if (!root) return;
  var config;
  try { config = JSON.parse(root.dataset.config || '{}'); } catch (error) {
    root.textContent = '项目库配置无法读取，请联系管理员。'; return;
  }
  var state = { projects: [], project: null, version: '', imageRole: 'effect', loading: false, uploading: false, files: [], limits: config.limits || {}, xhr: null, notice: '', uploadOpen: false };
  var lightbox = null, previousFocus = null, zoom = 1, lightboxIndex = 0, lightboxImages = [];
  var esc = function (value) { return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function safeUrl(value) {
    if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f\\]/.test(value) || /^\/\//.test(value)) return '';
    try { var url = new URL(value, document.baseURI); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch (error) { return ''; }
  }
  var apiUrl = safeUrl(config.apiUrl);
  if (!apiUrl) { root.textContent = '项目库接口地址无效，请联系管理员。'; return; }
  var canUpload = config.canUpload === true || config.canUpload === 1 || config.canUpload === '1';
  function pageLink(id) {
    var url = new URL(safeUrl(config.baseUrl) || window.location.href);
    url.searchParams.delete('project');
    if (id) url.searchParams.set('project', id);
    url.hash = '';
    return url.href;
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
  function activeVersion() { return versions(state.project).find(function (v) { return String(v.id) === state.version; }) || latest(state.project); }
  function assets(version) { return version && Array.isArray(version.assets) ? version.assets : []; }
  function date(value) { var d = new Date(value); return Number.isNaN(d.getTime()) ? '日期未记录' : d.toLocaleDateString('zh-CN'); }
  function bytes(value) {
    var n = Number(value); if (!Number.isFinite(n) || n < 0) return '';
    return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB';
  }
  function notice(message, error) { state.notice = message; var node = root.querySelector('[data-notice]'); if (node) { node.textContent = message; node.hidden = !message; node.classList.toggle('yd-error', !!error); node.setAttribute('role', error ? 'alert' : 'status'); } }
  function header() {
    return '<header class="yd-header"><a class="yd-brand" href="' + esc(pageLink()) + '"><span class="yd-brand-mark" aria-hidden="true">渔</span><span>渔岛设计资料库<small>项目 · 方案 · 现场资料</small></span></a><nav aria-label="项目导航"><a href="' + esc(pageLink()) + '">全部项目</a>' + (canUpload ? '<button type="button" class="yd-button yd-primary" data-action="open-upload">上传项目资料</button>' : '<span class="yd-readonly">共享浏览</span>') + '</nav></header>';
  }
  function render() {
    root.className = 'yd-app';
    root.innerHTML = header() + '<main class="yd-main"><div class="yd-notice" data-notice role="status"' + (!state.notice ? ' hidden' : '') + '>' + esc(state.notice) + '</div>' + (state.loading ? '<div class="yd-empty" role="status"><span class="yd-spinner" aria-hidden="true"></span><h2>正在读取项目资料…</h2></div>' : state.project ? renderDetail() : renderList()) + '</main>' + (canUpload ? renderUpload() : '');
    bindModels();
  }
  function bindModels() {
    root.querySelectorAll('model-viewer').forEach(function (viewer) {
      viewer.addEventListener('error', function () { var status = viewer.parentNode.querySelector('[data-model-status]'); if (status) { status.textContent = '模型预览暂时无法加载，请下载文件查看。'; status.hidden = false; } });
      viewer.addEventListener('load', function () { var status = viewer.parentNode.querySelector('[data-model-status]'); if (status) status.hidden = true; });
    });
  }
  function renderContent() {
    root.querySelector('.yd-main').innerHTML = '<div class="yd-notice" data-notice role="status"' + (!state.notice ? ' hidden' : '') + '>' + esc(state.notice) + '</div>' + renderDetail();
    bindModels();
  }
  function renderList() {
    var regions = Array.from(new Set(state.projects.map(function (p) { return p.region || '未分类'; })));
    return '<section class="yd-intro"><div><p class="yd-eyebrow">项目 · 设计 · 资料</p><h1>让每一版设计，都有迹可循</h1><p>现场原貌、方案效果、三维模型与图纸，按项目和版本集中查看。</p></div><div class="yd-summary"><strong>' + state.projects.length + '</strong><span>个项目</span></div></section>' +
      '<section aria-label="项目库"><div class="yd-toolbar"><h2>项目资料</h2><div class="yd-filters"><label class="yd-search"><span class="yd-sr-only">搜索项目</span><input type="search" data-search placeholder="搜索项目名称或区域"></label><label><span class="yd-sr-only">筛选区域</span><select data-region><option value="">全部区域</option>' + regions.map(function (r) { return '<option value="' + esc(r) + '">' + esc(r) + '</option>'; }).join('') + '</select></label></div></div><div class="yd-project-grid">' + state.projects.map(function (p) {
        var v = latest(p), images = assets(v).filter(function (a) { return a.kind === 'image' && safeUrl(a.url); });
        var cover = images.find(function (a) { return a.role === 'effect'; }) || images[0];
        return '<a class="yd-project-card" href="' + esc(pageLink(p.id)) + '" data-project-card data-search-text="' + esc((p.title || '') + ' ' + (p.region || '未分类')) + '" data-project-region="' + esc(p.region || '未分类') + '"><div class="yd-project-cover">' + (cover ? '<img src="' + esc(safeUrl(cover.url)) + '" alt="' + esc(p.title) + ' 项目预览" loading="lazy">' : '<span class="yd-cover-placeholder" aria-hidden="true">图纸 / 影像 / 模型</span>') + '<span class="yd-region-badge">' + esc(p.region || '未分类') + '</span></div><div class="yd-card-body"><h3>' + esc(p.title || '未命名项目') + '</h3><div class="yd-card-meta"><span>' + versions(p).length + ' 个版本</span><span>' + (v ? esc(v.label || '未命名版本') : '暂无资料') + '</span></div><p>' + (v ? '更新于 ' + esc(date(v.created_at)) : '等待首版资料') + '<span aria-hidden="true">↗</span></p></div></a>';
      }).join('') + '</div><div class="yd-empty" data-no-projects' + (state.projects.length ? ' hidden' : '') + '><h3>暂无项目资料</h3><p>' + (canUpload ? '上传首个项目，将现场与设计方案整理在一起。' : '管理员上传后，资料会显示在这里。') + '</p></div><div class="yd-empty" data-no-matches hidden><h3>没有找到匹配的项目</h3><p>请尝试其他关键词或区域。</p></div></section>';
  }
  function download(asset, label) {
    var url = safeUrl(asset.url); return url ? '<a class="yd-download" href="' + esc(url) + '" download target="_blank" rel="noopener">' + esc(label || '下载文件') + '<span aria-hidden="true"> ↓</span></a>' : '<span class="yd-file-unavailable">文件地址不可用</span>';
  }
  function renderDetail() {
    var p = state.project, v = activeVersion(), all = assets(v), imgs = all.filter(function (a) { return a.kind === 'image'; });
    var visible = imgs.filter(function (a) { return a.role === state.imageRole || (!['source', 'effect'].includes(a.role) && state.imageRole === 'effect'); });
    var models = all.filter(function (a) { return a.kind === 'model'; }), pdfs = all.filter(function (a) { return a.kind === 'pdf'; }), cads = all.filter(function (a) { return a.kind === 'cad'; }), documents = all.filter(function (a) { return a.kind === 'document'; });
    return '<a class="yd-back" href="' + esc(pageLink()) + '">← 返回项目库</a><section class="yd-detail-heading"><div><p class="yd-eyebrow">' + esc(p.region || '未分类') + '</p><h1>' + esc(p.title || '未命名项目') + '</h1><p>按版本查看现场、效果、模型和图纸。</p></div>' + (canUpload ? '<button type="button" class="yd-button yd-primary" data-action="open-upload">上传新版本</button>' : '') + '</section><section class="yd-version-panel" aria-label="项目版本"><label>当前版本<select data-version>' + versions(p).map(function (item) { return '<option value="' + esc(item.id) + '"' + (v && item.id === v.id ? ' selected' : '') + '>' + esc(item.label || '未命名版本') + ' · ' + esc(date(item.created_at)) + '</option>'; }).join('') + '</select></label><div><span class="yd-meta">' + (v ? '保存于 ' + esc(date(v.created_at)) + ' · ' + all.length + ' 个文件' : '暂无版本') + '</span><p class="yd-description">' + esc(v && v.description || '此版本未填写说明。') + '</p></div></section>' +
      (imgs.length ? '<section class="yd-section"><div class="yd-section-heading"><h2>项目影像</h2><div class="yd-tabs" role="group" aria-label="影像类型"><button type="button" data-image-role="effect" aria-pressed="' + (state.imageRole === 'effect') + '">效果图 <span>' + imgs.filter(function (a) { return a.role !== 'source'; }).length + '</span></button><button type="button" data-image-role="source" aria-pressed="' + (state.imageRole === 'source') + '">原始现场 <span>' + imgs.filter(function (a) { return a.role === 'source'; }).length + '</span></button></div></div><div class="yd-image-grid">' + visible.map(function (a) { var url = safeUrl(a.url); return '<figure class="yd-image-card">' + (url ? '<button type="button" data-image-id="' + esc(a.id) + '" aria-label="放大查看 ' + esc(a.name) + '"><img src="' + esc(url) + '" alt="' + esc(a.name) + '" loading="lazy"><span class="yd-image-hint">放大查看 ↗</span></button>' : '<div class="yd-empty">图片地址不可用</div>') + '<figcaption><span title="' + esc(a.name) + '">' + esc(a.name) + '</span>' + download(a, '原图') + '</figcaption></figure>'; }).join('') + '</div>' + (!visible.length ? '<div class="yd-empty">此版本没有' + (state.imageRole === 'source' ? '原始现场图片' : '效果图') + '。</div>' : '') + '</section>' : '') +
      (models.length ? '<section class="yd-section"><div class="yd-section-heading"><h2>三维模型</h2><p>拖动旋转 · 滚轮或双指缩放</p></div><div class="yd-model-grid">' + models.map(function (a) { var url = safeUrl(a.url); return '<article class="yd-model-card"><div class="yd-file-heading"><h3>' + esc(a.name) + '</h3>' + download(a) + '</div>' + (url ? '<model-viewer src="' + esc(url) + '" alt="' + esc(a.name) + ' 三维模型" camera-controls auto-rotate touch-action="pan-y" interaction-prompt="auto"><span slot="poster" class="yd-model-poster">三维模型加载中…</span></model-viewer><p class="yd-preview-status" data-model-status>首次加载可能需要一些时间，可同时下载原文件。</p>' : '<div class="yd-empty">模型地址不可用</div>') + '</article>'; }).join('') + '</div></section>' : '') +
      (pdfs.length ? '<section class="yd-section"><div class="yd-section-heading"><h2>方案文档</h2><p>同页阅读与文件下载</p></div>' + pdfs.map(function (a) { var url = safeUrl(a.url); return '<article class="yd-pdf-card"><div class="yd-file-heading"><h3>' + esc(a.name) + '</h3>' + download(a) + '</div>' + (url ? '<iframe src="' + esc(url) + '" title="' + esc(a.name) + ' PDF 预览" loading="lazy"></iframe><p class="yd-preview-status">如果浏览器未显示 PDF，请点击上方下载文件。</p>' : '<div class="yd-empty">文档地址不可用</div>') + '</article>'; }).join('') + '</section>' : '') +
      (cads.length ? '<section class="yd-section"><div class="yd-section-heading"><h2>CAD 图纸</h2><p>下载后使用 CAD 软件查看</p></div><ul class="yd-file-list">' + cads.map(function (a) { return '<li><span class="yd-file-icon" aria-hidden="true">CAD</span><div><strong>' + esc(a.name) + '</strong><span>' + esc(bytes(a.bytes)) + '</span></div>' + download(a, '下载图纸') + '</li>'; }).join('') + '</ul></section>' : '') + (documents.length ? '<section class="yd-section"><div class="yd-section-heading"><h2>配色与说明文件</h2><p>下载原始表格与文字说明</p></div><ul class="yd-file-list">' + documents.map(function (a) { return '<li><span class="yd-file-icon" aria-hidden="true">FILE</span><div><strong>' + esc(a.name) + '</strong><span>' + esc(bytes(a.bytes)) + '</span></div>' + download(a) + '</li>'; }).join('') + '</ul></section>' : '') + (!all.length ? '<div class="yd-empty"><h3>此版本暂无文件</h3><p>' + (canUpload ? '通过上传项目资料添加首版内容。' : '请等待管理员上传资料。') + '</p></div>' : '');
  }
  function renderUpload() {
    return '<section class="yd-upload-panel" data-upload-panel' + (!state.uploadOpen ? ' hidden' : '') + ' aria-labelledby="yd-upload-title"><div class="yd-upload-inner"><div class="yd-section-heading"><div><p class="yd-eyebrow">统一资料上传</p><h2 id="yd-upload-title">上传项目资料</h2></div><button type="button" class="yd-close" data-action="close-upload" aria-label="关闭上传面板">×</button></div><p class="yd-upload-lead">一次提交一个版本，图片、模型、PDF 和 CAD 图纸可一起上传。</p><form data-upload-form><div class="yd-form-grid"><label class="yd-field yd-field-wide">归属项目<select name="project_id" data-upload-project><option value="">新建项目</option>' + state.projects.map(function (p) { return '<option value="' + esc(p.id) + '"' + (state.project && state.project.id === p.id ? ' selected' : '') + '>' + esc(p.title) + '</option>'; }).join('') + '</select></label><label class="yd-field">项目名称<input name="title" required maxlength="160" value="' + esc(state.project && state.project.title || '') + '"' + (state.project ? ' readonly' : '') + ' placeholder="例如：室外温泉景观改造"></label><label class="yd-field">所属区域<input name="region" maxlength="160" value="' + esc(state.project && state.project.region || '') + '"' + (state.project ? ' readonly' : '') + ' placeholder="例如：温泉区"></label><label class="yd-field yd-field-wide">版本名称<input name="version" required maxlength="100" placeholder="例如：R03 · 方案汇报"></label><label class="yd-field yd-field-wide">版本说明<textarea name="description" rows="3" maxlength="5000" placeholder="记录本版内容、调整范围或待确认事项"></textarea></label></div><label class="yd-dropzone"><span class="yd-drop-icon" aria-hidden="true">↑</span><strong>选择或拖入本版文件</strong><span>图片、GLB、PDF、DWG / DXF、CSV / TXT</span><input type="file" name="files[]" multiple required accept=".jpg,.jpeg,.png,.webp,.glb,.pdf,.dwg,.dxf,.csv,.txt" data-files></label><p class="yd-upload-limits">' + esc(limitText()) + '</p><div data-file-selection aria-live="polite"></div><div class="yd-upload-status" data-upload-status role="status" hidden><progress max="100" value="0"></progress><p></p></div><div class="yd-upload-actions"><span>服务器确认保存成功后，才会更新项目资料。</span><button type="button" class="yd-button" data-action="cancel-upload" hidden>取消上传</button><button type="submit" class="yd-button yd-primary">保存此版本</button></div></form></div></section>';
  }
  async function load() {
    state.loading = true; render();
    try {
      var id = new URL(window.location.href).searchParams.get('project');
      var list = await get('yudaoDesign.projects.list');
      if (!Array.isArray(list.projects)) throw new Error('项目列表格式不正确。');
      state.projects = list.projects; state.limits = list.limits || state.limits;
      if (id) { var detail = await get('yudaoDesign.projects.get', { project_id: id }); if (!detail.project) throw new Error('未找到该项目。'); state.project = detail.project; state.version = String((latest(state.project) || {}).id || ''); chooseImageRole(activeVersion()); }
      state.loading = false; render();
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
    if (limits.max_file_bytes > 0) text.push('每个文件不超过 ' + bytes(limits.max_file_bytes));
    if (limits.max_total_bytes > 0) text.push('本次总容量不超过 ' + bytes(limits.max_total_bytes));
    return text.join(' · ');
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
      if (limits.max_file_bytes > 0 && file.size > limits.max_file_bytes) return file.name + ' 超过单文件限制（' + bytes(limits.max_file_bytes) + '）。';
    }
    if (limits.max_total_bytes > 0 && total > limits.max_total_bytes) return '总容量超过本次上传限制（' + bytes(limits.max_total_bytes) + '），请减少文件。';
    return '';
  }
  function selectFiles(files) {
    state.files = Array.from(files || []).map(function (file) { return { file: file, role: 'source' }; });
    var target = root.querySelector('[data-file-selection]');
    target.innerHTML = state.files.length ? '<p class="yd-selection-summary">已选择 ' + state.files.length + ' 个文件 · ' + esc(bytes(state.files.reduce(function (sum, item) { return sum + item.file.size; }, 0))) + '</p><ul class="yd-selected-files">' + state.files.map(function (item, index) {
      var image = /\.(jpe?g|png|webp)$/i.test(item.file.name);
      return '<li><div><strong>' + esc(item.file.name) + '</strong><span>' + esc(bytes(item.file.size)) + '</span></div>' + (image ? '<label><span class="yd-sr-only">' + esc(item.file.name) + ' 的图片类型</span><select data-file-role="' + index + '"><option value="source">原始现场</option><option value="effect">效果图</option></select></label>' : '<span class="yd-file-type">' + (/\.(glb)$/i.test(item.file.name) ? '三维模型' : /\.pdf$/i.test(item.file.name) ? '方案文档' : 'CAD / 文件') + '</span>') + '</li>';
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
  function submitUpload(form) {
    if (state.uploading || !form.reportValidity()) return;
    if (!state.files.length) { uploadStatus('请先选择至少一个文件。', 0, true); return; }
    var fileError = validateFiles(); if (fileError) { uploadStatus(fileError, 0, true); return; }
    var data = new FormData();
    ['title', 'region', 'version', 'description', 'project_id'].forEach(function (key) { var value = form.elements[key].value.trim(); if (value || key !== 'project_id') data.append(key, value); });
    data.append('method', 'yudaoDesign.projects.import'); data.append('pwg_token', config.token || '');
    state.files.forEach(function (item) { data.append('files[]', item.file, item.file.name); });
    data.append('manifest', JSON.stringify(state.files.map(function (item) { return { name: item.file.name, role: /\.(jpe?g|png|webp)$/i.test(item.file.name) ? item.role : 'document' }; })));
    uploadBusy(true); uploadStatus('正在上传文件…', 0);
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
        if (!result.project || !result.project.id) throw new Error('服务器未确认保存项目，请核查后重试。');
        state.project = result.project; state.version = String((latest(state.project) || {}).id || ''); chooseImageRole(activeVersion());
        var index = state.projects.findIndex(function (p) { return p.id === result.project.id; }); if (index >= 0) state.projects[index] = result.project; else state.projects.unshift(result.project);
        state.files = []; state.uploading = false; state.xhr = null; state.uploadOpen = false; state.notice = '版本已保存，项目资料已更新。';
        var savedUrl = new URL(window.location.href); savedUrl.searchParams.set('project', result.project.id);
        window.history.replaceState(null, '', savedUrl.href); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
        try { var fresh = await get('yudaoDesign.projects.get', { project_id: result.project.id }); if (fresh.project && state.project && state.project.id === result.project.id && !state.uploading) { state.project = fresh.project; renderContent(); } } catch (error) { notice('版本已保存；重新读取暂时失败，当前显示服务器保存结果。', false); }
      } catch (error) { uploadBusy(false); state.xhr = null; uploadStatus(error.message || '上传失败，请检查后重试。', 0, true); }
    });
    xhr.addEventListener('error', function () { uploadBusy(false); state.xhr = null; uploadStatus('网络中断，尚未收到保存确认。请刷新核对项目版本后再重试。', 0, true); });
    xhr.addEventListener('abort', function () { uploadBusy(false); state.xhr = null; uploadStatus('上传已取消。若文件已传输，请刷新核对是否已保存。', 0, true); });
    xhr.send(data);
  }
  function openLightbox(id) {
    lightboxImages = assets(activeVersion()).filter(function (a) { return a.kind === 'image' && safeUrl(a.url) && (a.role === state.imageRole || (!['source', 'effect'].includes(a.role) && state.imageRole === 'effect')); });
    lightboxIndex = lightboxImages.findIndex(function (a) { return String(a.id) === id; }); if (lightboxIndex < 0) return;
    previousFocus = document.activeElement; lightbox = document.createElement('div'); lightbox.className = 'yd-lightbox'; lightbox.setAttribute('role', 'dialog'); lightbox.setAttribute('aria-modal', 'true'); lightbox.setAttribute('aria-label', '图片放大预览');
    lightbox.innerHTML = '<div class="yd-lightbox-toolbar"><strong data-lightbox-name></strong><div><button type="button" data-lightbox="out" aria-label="缩小">−</button><span data-zoom-value>100%</span><button type="button" data-lightbox="in" aria-label="放大">＋</button><button type="button" data-lightbox="reset">适应窗口</button><a data-lightbox-download download target="_blank" rel="noopener">下载原图 ↓</a><button type="button" data-lightbox="close" aria-label="关闭图片预览">×</button></div></div><div class="yd-lightbox-stage"><img alt=""></div><div class="yd-lightbox-footer"><button type="button" data-lightbox="previous">← 上一张</button><span data-image-counter></span><button type="button" data-lightbox="next">下一张 →</button></div>';
    document.body.appendChild(lightbox); lightbox.querySelector('img').addEventListener('load', function () { setZoom(zoom); }); document.body.classList.add('yd-modal-open'); updateLightbox(); lightbox.querySelector('[data-lightbox="close"]').focus();
    lightbox.addEventListener('click', function (event) { var button = event.target.closest('[data-lightbox]'); if (!button) return; var action = button.dataset.lightbox; if (action === 'close') closeLightbox(); else if (action === 'in') setZoom(zoom + 0.5); else if (action === 'out') setZoom(zoom - 0.5); else if (action === 'reset') setZoom(1); else { lightboxIndex = (lightboxIndex + (action === 'next' ? 1 : -1) + lightboxImages.length) % lightboxImages.length; updateLightbox(); } });
  }
  function updateLightbox() { var item = lightboxImages[lightboxIndex]; lightbox.querySelector('img').src = safeUrl(item.url); lightbox.querySelector('img').alt = item.name || '项目图片'; lightbox.querySelector('[data-lightbox-name]').textContent = item.name || '项目图片'; lightbox.querySelector('[data-lightbox-download]').href = safeUrl(item.url); lightbox.querySelector('[data-image-counter]').textContent = (lightboxIndex + 1) + ' / ' + lightboxImages.length; lightbox.querySelectorAll('[data-lightbox="next"], [data-lightbox="previous"]').forEach(function (button) { button.disabled = lightboxImages.length < 2; }); setZoom(1); }
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
      if (action.dataset.action === 'open-upload') { if (state.uploading) return; state.uploadOpen = true; var panel = root.querySelector('[data-upload-panel]'); panel.hidden = false; panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); panel.querySelector('input[name="title"]').focus({ preventScroll: true }); }
      else if (action.dataset.action === 'close-upload' && !state.uploading) { state.uploadOpen = false; root.querySelector('[data-upload-panel]').hidden = true; root.querySelector('[data-action="open-upload"]').focus(); }
      else if (action.dataset.action === 'cancel-upload' && state.xhr) state.xhr.abort();
    }
    var tab = event.target.closest('[data-image-role]'); if (tab && !state.uploading) { state.imageRole = tab.dataset.imageRole; var scrollY = window.scrollY; renderContent(); window.scrollTo(0, scrollY); }
    var image = event.target.closest('[data-image-id]'); if (image) openLightbox(image.dataset.imageId);
  });
  root.addEventListener('change', function (event) {
    var target = event.target;
    if (target.matches('[data-version]') && !state.uploading) { state.version = target.value; chooseImageRole(activeVersion()); renderContent(); }
    else if (target.matches('[data-region]')) filterProjects();
    else if (target.matches('[data-files]')) selectFiles(target.files);
    else if (target.matches('[data-file-role]') && state.files[Number(target.dataset.fileRole)]) state.files[Number(target.dataset.fileRole)].role = target.value;
    else if (target.matches('[data-upload-project]')) { var selected = state.projects.find(function (p) { return String(p.id) === target.value; }), form = root.querySelector('[data-upload-form]'); form.elements.title.value = selected ? selected.title || '' : ''; form.elements.region.value = selected ? selected.region || '' : ''; form.elements.title.readOnly = !!selected; form.elements.region.readOnly = !!selected; }
  });
  root.addEventListener('input', function (event) { if (event.target.matches('[data-search]')) filterProjects(); });
  root.addEventListener('submit', function (event) { if (event.target.matches('[data-upload-form]')) { event.preventDefault(); submitUpload(event.target); } });
  root.addEventListener('dragover', function (event) { if (event.target.closest('.yd-dropzone') && !state.uploading) { event.preventDefault(); event.target.closest('.yd-dropzone').classList.add('yd-dragover'); } });
  root.addEventListener('dragleave', function (event) { var zone = event.target.closest('.yd-dropzone'); if (zone && !zone.contains(event.relatedTarget)) zone.classList.remove('yd-dragover'); });
  root.addEventListener('drop', function (event) { var zone = event.target.closest('.yd-dropzone'); if (!zone) return; event.preventDefault(); zone.classList.remove('yd-dragover'); if (!state.uploading && event.dataTransfer && event.dataTransfer.files.length) { var input = zone.querySelector('input'); input.files = event.dataTransfer.files; selectFiles(input.files); } });
  load();
}());
