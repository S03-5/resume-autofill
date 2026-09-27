// ============================================================
// 页面内 HUD：右下角可拖拽悬浮球 + 填写战报浮层
// - 悬浮球：点击展开动作菜单（填写 / 撤销 / 后续接入的「记一笔」），可拖动换位置并记忆
// - 战报浮层：汇总「已填多少、还差哪些没填上」，点一条就能滚动定位到对应控件
// - 用 Shadow DOM 隔离，避免被招聘站点的全局 CSS 影响；只在顶层窗口显示，避免 iframe 里出现多个球
// ============================================================
(function () {
  if (window.__JIANLI_HUD_READY__) return;
  window.__JIANLI_HUD_READY__ = true;

  const BALL_SIZE = 44;
  const MARGIN = 14;
  const EDGE = 6;          // 距视口边缘的最小留白
  const DRAG_THRESHOLD = 4; // 位移超过这个像素才算拖拽，否则算点击

  const CSS = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  font-size: 13px;
  color: #0f172a;
}
* { box-sizing: border-box; }
button { all: unset; box-sizing: border-box; cursor: pointer; font: inherit; color: inherit; }

/* hidden 属性必须能盖住下面的 display 声明。
   浏览器默认的 [hidden]{display:none} 属于 UA 样式表，而作者样式表里的
   .report / .modal / .pick-bar 都写了 display:flex —— 作者样式无条件优先于 UA 样式，
   所以只设 el.hidden = true 是不生效的，表现为「点右上角的叉关不掉」「点选面板弹出来就再也收不回去」。
   这条 !important 是对该类问题的统一兜底，新增面板不用再各自小心。 */
[hidden] { display: none !important; }

.ball {
  position: fixed; width: ${BALL_SIZE}px; height: ${BALL_SIZE}px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #16a34a, #0d9488);
  color: #fff; font-size: 21px; line-height: 1;
  cursor: grab; user-select: none; -webkit-user-select: none; touch-action: none;
  box-shadow: 0 6px 18px rgba(15, 23, 42, .28);
  transition: transform .14s ease, box-shadow .14s ease;
}
.ball:hover { transform: scale(1.08); box-shadow: 0 8px 22px rgba(15, 23, 42, .34); }
.ball.dragging { cursor: grabbing; transform: scale(1.06); transition: none; }
.ball.busy { animation: jl-pulse .9s ease-in-out infinite; }
@keyframes jl-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .5; } }

.panel {
  position: fixed; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, .18); overflow: hidden;
}

.menu { min-width: 186px; padding: 6px; }
.menu-title { padding: 6px 10px 8px; font-size: 11.5px; font-weight: 700; color: #94a3b8; letter-spacing: .04em; }
.menu .item {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 8px 10px; border-radius: 8px; font-size: 13px; color: #0f172a; text-align: left;
}
.menu .item:hover { background: #f1f5f9; }
.menu .item .ic { width: 17px; text-align: center; font-size: 14px; }
.menu .item .tx { flex: 1; white-space: nowrap; }
.menu .item.primary { color: #16a34a; font-weight: 600; }
.menu-foot { padding: 7px 10px 4px; font-size: 11px; color: #cbd5e1; border-top: 1px solid #f1f5f9; margin-top: 4px; }

.report { width: 302px; max-height: 62vh; display: flex; flex-direction: column; }
.rp-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 8px; }
.rp-title { font-size: 13px; font-weight: 700; }
.rp-x { width: 22px; height: 22px; border-radius: 6px; display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 12px; }
.rp-x:hover { background: #f1f5f9; color: #0f172a; }
.rp-sum { padding: 0 12px 9px; font-size: 12.5px; color: #64748b; }
.rp-sum b { font-size: 15px; }
.rp-sum b.ok { color: #16a34a; }
.rp-sum b.warn { color: #d97706; }
.rp-body { overflow-y: auto; padding: 0 8px 6px; }
.rp-group { padding: 8px 4px 4px; font-size: 11.5px; font-weight: 700; color: #94a3b8; }
.rp-item {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 7px 8px; border-radius: 7px; font-size: 12.5px; text-align: left;
  cursor: pointer;
}
.rp-item:hover { background: #f8fafc; }
.rp-item .nm { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rp-item .rs { font-size: 11px; color: #f59e0b; white-space: nowrap; }
.rp-item .go { font-size: 11px; color: #16a34a; white-space: nowrap; }
.rp-item .rm {
  font-size: 11px; color: #16a34a; background: #f0fdf4; border: 1px solid #bbf7d0;
  border-radius: 6px; padding: 2px 6px; white-space: nowrap; cursor: pointer;
}
.rp-item .rm:hover { background: #dcfce7; }
.rp-empty { padding: 10px 12px 14px; font-size: 12.5px; color: #16a34a; }
.rp-hint { padding: 2px 8px 6px; font-size: 11.5px; color: #94a3b8; line-height: 1.55; }

/* 匹配不上一个下拉时，把它有哪些选项摊开给用户看，免得回去一个个点 */
.rp-opts {
  margin: -2px 6px 6px 14px; padding: 6px 8px; border-left: 2px solid #dbeafe;
  font-size: 11px; color: #475569; line-height: 1.6; word-break: break-all;
  background: #f8fafc; border-radius: 0 6px 6px 0;
}
.rp-opts b { color: #94a3b8; font-weight: 600; }

/* 岗位推断：插件改写了意向字段，必须让用户看见这次改动 */
.rp-infer { margin: 4px 4px 2px; padding: 8px 9px; border-radius: 8px; background: #eff6ff; border: 1px solid #bfdbfe; }
.rp-infer .it { font-size: 11.5px; font-weight: 700; color: #1d4ed8; }
.rp-infer .iv { margin-top: 3px; font-size: 12.5px; color: #0f172a; line-height: 1.5; word-break: break-all; }
.rp-infer .ir { margin-top: 3px; font-size: 11px; color: #64748b; line-height: 1.4; word-break: break-all; }
.rp-foot { padding: 8px 10px 10px; border-top: 1px solid #f1f5f9; }
.rp-undo {
  display: block; width: 100%; padding: 8px; border-radius: 8px; text-align: center;
  font-size: 12.5px; color: #0f172a; background: #f1f5f9;
}
.rp-undo:hover { background: #e2e8f0; }
.rp-undo:disabled { opacity: .5; cursor: default; }

/* 点选模式：顶部提示条 */
.pick-bar {
  position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
  display: flex; align-items: center; gap: 10px;
  padding: 9px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.45;
  background: rgba(15, 23, 42, .94); color: #fff;
  box-shadow: 0 8px 24px rgba(15, 23, 42, .3);
  max-width: min(720px, calc(100vw - 24px));
}
.pick-bar .tx { flex: 1; }
.pick-bar .cn {
  padding: 4px 9px; border-radius: 7px; background: rgba(255, 255, 255, .16);
  font-size: 12px; white-space: nowrap; cursor: pointer;
}
.pick-bar .cn:hover { background: rgba(255, 255, 255, .3); }

/* 模态面板：字段选择 / 结果列表 */
.modal { width: 344px; max-height: 68vh; display: flex; flex-direction: column; }
.md-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px 6px; }
.md-title { font-size: 13px; font-weight: 700; }
.md-sub { padding: 0 12px 8px; font-size: 11.5px; color: #64748b; line-height: 1.5; white-space: pre-line; }
.md-search { margin: 0 12px 8px; }
.md-search input {
  display: block; width: 100%; padding: 6px 9px; border: 1px solid #cbd5e1;
  border-radius: 7px; font: inherit; font-size: 12.5px; color: #0f172a; background: #fff;
}
.md-search input:focus { outline: 2px solid #bbf7d0; outline-offset: -1px; border-color: #16a34a; }
.md-body { overflow-y: auto; padding: 0 6px 8px; flex: 1; min-height: 110px; }
.md-group { padding: 8px 8px 4px; font-size: 11px; font-weight: 700; color: #94a3b8; }
.md-item {
  display: block; width: 100%; padding: 7px 8px; border-radius: 7px;
  font-size: 12.5px; text-align: left; cursor: pointer;
}
.md-item:hover { background: #f1f5f9; }
.md-item .kd, .md-row .kd { color: #94a3b8; font-size: 11px; margin-left: 6px; }
.md-row { display: block; padding: 7px 8px; border-radius: 7px; font-size: 12.5px; }
.md-row .nm { word-break: break-all; }
.md-empty { padding: 12px; font-size: 12.5px; color: #94a3b8; }
.md-foot { padding: 8px 10px 10px; border-top: 1px solid #f1f5f9; display: flex; gap: 8px; }
.md-btn {
  flex: 1; padding: 8px 6px; border-radius: 8px; text-align: center; font-size: 12.5px;
  background: #f1f5f9; color: #0f172a; white-space: nowrap; cursor: pointer;
}
.md-btn:hover { background: #e2e8f0; }
.md-btn.primary { background: #16a34a; color: #fff; }
.md-btn.primary:hover { background: #15803d; }
.md-btn.danger { color: #b91c1c; }

/* 页面内提示卡：投递成功这类需要用户点头才动手的事 */
.prompt {
  position: fixed; right: 14px; bottom: 62px;
  width: 290px; padding: 11px 12px;
  background: #fff; border: 1px solid #e2e8f0; border-radius: 11px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, .16);
}
.prompt .pt-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.prompt .pt-title { font-size: 13px; font-weight: 700; color: #0f172a; }
.prompt .pt-x {
  flex: 0 0 auto; width: 20px; height: 20px; border: none; border-radius: 5px;
  background: transparent; color: #94a3b8; font-size: 12px; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.prompt .pt-x:hover { background: #f1f5f9; color: #0f172a; }
.prompt .pt-text { margin-top: 5px; font-size: 12.5px; color: #475569; line-height: 1.55; word-break: break-all; }
.prompt .pt-acts { display: flex; gap: 7px; margin-top: 10px; }
.prompt .pt-acts button {
  flex: 1; padding: 7px 8px; border: none; border-radius: 8px;
  font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
}
.prompt .pt-acts .ghost-btn { background: #f1f5f9; color: #334155; }
.prompt .pt-acts .ghost-btn:hover { background: #e2e8f0; }
.prompt .pt-acts .pri-btn { background: #16a34a; color: #fff; }
.prompt .pt-acts .pri-btn:hover { background: #15803d; }

.toast {
  position: fixed; left: 50%; bottom: 34px; transform: translateX(-50%);
  padding: 9px 15px; border-radius: 9px; font-size: 12.5px; max-width: 420px;
  background: rgba(15, 23, 42, .92); color: #fff; box-shadow: 0 8px 24px rgba(15, 23, 42, .3);
}
.toast.err { background: rgba(185, 28, 28, .94); }
.toast.ok { background: rgba(21, 128, 61, .94); }
`;

  const state = {
    ready: false,
    visible: false,
    busy: false,
    pos: null,          // {x, y} 悬浮球左上角坐标，null 表示默认右下角
    toastTimer: 0,
    reportTimer: 0,
    promptOnClose: null // 提示卡关掉时要回调（用来把浮层收回去）
  };

  const actions = [];
  let host = null, shadow = null, ballEl = null, menuEl = null, reportEl = null, toastEl = null;
  // 点选提示条 / 字段选择面板 / 结果面板。必须显式声明：
  // 否则它们会变成隐式全局变量，和页面上的同名全局撞车。
  let pickBarEl = null, pickerEl = null, collectEl = null, openModal = null;
  let promptEl = null;
  let drag = null, rafId = 0, savePosTimer = 0;
  const flashBackup = new WeakMap();

  const clampX = x => Math.max(EDGE, Math.min(x, window.innerWidth - BALL_SIZE - EDGE));
  const clampY = y => Math.max(EDGE, Math.min(y, window.innerHeight - BALL_SIZE - EDGE));

  // ---------- 构建 DOM ----------

  function ensure() {
    // 元素齐了才算就绪：万一中途 unmount 过、或者有谁把节点删了，这里会重建
    if (state.ready && host && shadow && ballEl && pickBarEl && pickerEl && collectEl && promptEl) return true;
    // 重建前先把旧宿主摘掉，避免页面上出现两个悬浮球
    if (host && host.isConnected) {
      try { host.remove(); } catch (e) { /* ignore */ }
    }
    state.ready = false;
    if (!document.body && !document.documentElement) return false;

    host = document.createElement("div");
    host.id = "jianli-hud-host";
    // 用 inline 样式保证层级与定位优先级（shadow 内的 :host{all:initial} 不会覆盖 inline）
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000;";
    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);

    ballEl = document.createElement("div");
    ballEl.className = "ball";
    ballEl.title = "简历助手：点击展开，拖动可换位置";
    ballEl.textContent = "⚡";
    shadow.appendChild(ballEl);

    menuEl = document.createElement("div");
    menuEl.className = "panel menu";
    menuEl.hidden = true;
    shadow.appendChild(menuEl);

    reportEl = document.createElement("div");
    reportEl.className = "panel report";
    reportEl.hidden = true;
    shadow.appendChild(reportEl);

    toastEl = document.createElement("div");
    toastEl.className = "toast";
    toastEl.hidden = true;
    shadow.appendChild(toastEl);

    pickBarEl = document.createElement("div");
    pickBarEl.className = "pick-bar";
    pickBarEl.hidden = true;
    shadow.appendChild(pickBarEl);

    pickerEl = document.createElement("div");
    pickerEl.className = "panel modal picker";
    pickerEl.hidden = true;
    shadow.appendChild(pickerEl);

    collectEl = document.createElement("div");
    collectEl.className = "panel modal collect";
    collectEl.hidden = true;
    shadow.appendChild(collectEl);

    promptEl = document.createElement("div");
    promptEl.className = "prompt";
    promptEl.hidden = true;
    shadow.appendChild(promptEl);

    ballEl.addEventListener("pointerdown", onPointerDown);
    ballEl.addEventListener("contextmenu", e => e.preventDefault());

    (document.body || document.documentElement).appendChild(host);
    window.addEventListener("resize", () => { if (state.ready) applyPos(); });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") { hideMenu(); hideReport(); hidePrompt(); closeModals(); }
    }, true);

    state.ready = true;
    applyPos();
    return true;
  }

  function applyPos() {
    if (!ballEl) return;
    const x = state.pos ? state.pos.x : window.innerWidth - BALL_SIZE - MARGIN;
    const y = state.pos ? state.pos.y : window.innerHeight - BALL_SIZE - MARGIN;
    ballEl.style.left = clampX(x) + "px";
    ballEl.style.top = clampY(y) + "px";
  }

  // ---------- 显示 / 隐藏 ----------

  function mount(visible, savedPos) {
    state.visible = !!visible;
    if (savedPos && typeof savedPos.x === "number") state.pos = { x: savedPos.x, y: savedPos.y };
    if (!state.visible) {
      if (state.ready && host && host.isConnected) host.remove();
      state.ready = false;
      host = shadow = ballEl = menuEl = reportEl = toastEl = null;
      pickBarEl = pickerEl = collectEl = openModal = null;
      promptEl = null;
      return;
    }
    if (!ensure()) return;
    applyPos();
  }

  function isMounted() { return state.ready && host && host.isConnected; }

  // ---------- 拖拽 ----------

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const r = ballEl.getBoundingClientRect();
    drag = {
      id: e.pointerId,
      dx: e.clientX - r.left,
      dy: e.clientY - r.top,
      startX: e.clientX,
      startY: e.clientY,
      moved: false
    };
    try { ballEl.setPointerCapture(e.pointerId); } catch (err) { /* 老浏览器忽略 */ }
    ballEl.classList.add("dragging");
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (Math.abs(e.clientX - drag.startX) > DRAG_THRESHOLD || Math.abs(e.clientY - drag.startY) > DRAG_THRESHOLD) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    e.preventDefault();
    const nx = clampX(e.clientX - drag.dx);
    const ny = clampY(e.clientY - drag.dy);
    state.pos = { x: nx, y: ny };
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; applyPos(); });
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerUp, true);
    ballEl.classList.remove("dragging");
    try { ballEl.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    if (moved) {
      scheduleSavePos();
    } else {
      menuEl.hidden ? openMenu() : hideMenu();
    }
  }

  // 位置记忆：拖动结束后去抖写入 storage，避免拖拽过程中频繁写
  function scheduleSavePos() {
    clearTimeout(savePosTimer);
    savePosTimer = setTimeout(() => {
      try { chrome.storage.local.set({ hudPos: state.pos }); } catch (e) { /* ignore */ }
    }, 400);
  }

  // ---------- 动作菜单 ----------

  function registerAction(action) {
    if (!action || !action.id) return;
    const idx = actions.findIndex(a => a.id === action.id);
    if (idx >= 0) actions[idx] = action;
    else actions.push(action);
    if (isMounted() && !menuEl.hidden) renderMenu();
  }

  function renderMenu() {
    menuEl.textContent = "";
    const title = document.createElement("div");
    title.className = "menu-title";
    title.textContent = "简历助手";
    menuEl.appendChild(title);

    for (const a of actions) {
      const btn = document.createElement("button");
      btn.className = "item" + (a.primary ? " primary" : "");
      if (a.hint) btn.title = a.hint;

      const ic = document.createElement("span");
      ic.className = "ic";
      ic.textContent = a.icon || "";
      const tx = document.createElement("span");
      tx.className = "tx";
      tx.textContent = a.label || a.id;
      btn.appendChild(ic);
      btn.appendChild(tx);

      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        hideMenu();
        if (!a.onClick) return;
        try {
          await a.onClick();
        } catch (err) {
          toast("操作失败：" + (err && err.message ? err.message : "未知错误"), "err");
        }
      });
      menuEl.appendChild(btn);
    }

    const foot = document.createElement("div");
    foot.className = "menu-foot";
    foot.textContent = "拖动小球可换位置";
    menuEl.appendChild(foot);
  }

  function openMenu() {
    if (!ensure()) return;
    renderMenu();
    menuEl.hidden = false;
    menuEl.style.visibility = "hidden";
    const r = ballEl.getBoundingClientRect();
    const mw = menuEl.offsetWidth;
    const mh = menuEl.offsetHeight;
    const below = window.innerHeight - (r.bottom + 8);
    const top = below >= mh ? r.bottom + 8 : Math.max(EDGE, r.top - mh - 8);
    const left = (r.left + mw > window.innerWidth - EDGE) ? Math.max(EDGE, window.innerWidth - mw - EDGE) : r.left;
    menuEl.style.left = left + "px";
    menuEl.style.top = top + "px";
    menuEl.style.visibility = "";
  }

  function hideMenu() { if (menuEl) menuEl.hidden = true; }

  // ---------- 战报浮层 ----------

  function renderReport(summary, refs) {
    const s = summary || {};
    const pending = (refs && refs.pending) || [];
    const unknown = (refs && refs.unknown) || [];
    const knownEmpty = (refs && refs.knownEmpty) || [];
    const waiting = pending.length + unknown.length + knownEmpty.length;

    reportEl.textContent = "";

    const head = document.createElement("div");
    head.className = "rp-head";
    const title = document.createElement("span");
    title.className = "rp-title";
    title.textContent = s.adapter ? "填写结果（" + s.adapter + "）" : "填写结果";
    const close = document.createElement("button");
    close.className = "rp-x";
    close.textContent = "✕";
    close.addEventListener("click", hideReport);
    head.appendChild(title);
    head.appendChild(close);
    reportEl.appendChild(head);

    const sum = document.createElement("div");
    sum.className = "rp-sum";
    sum.innerHTML = "已填 <b class=\"ok\">" + (s.filled || 0) + "</b> · 待手填 <b class=\"warn\">" + waiting + "</b>";
    reportEl.appendChild(sum);

    const body = document.createElement("div");
    body.className = "rp-body";

    // 岗位推断改写了意向字段：摆在最上面，否则用户会以为插件填错了
    const inf = s.inferred;
    if (inf && inf.applied && Object.keys(inf.applied).length) {
      const box = document.createElement("div");
      box.className = "rp-infer";
      const t = document.createElement("div");
      t.className = "it";
      t.textContent = "🎯 按当前岗位调整了意向字段";
      box.appendChild(t);
      const v = document.createElement("div");
      v.className = "iv";
      const parts = [];
      if (inf.applied.position) parts.push("期望职位 → " + inf.applied.position);
      if (inf.applied.city) parts.push("期望城市 → " + inf.applied.city);
      v.textContent = parts.join("；");
      box.appendChild(v);
      if (inf.raw) {
        const r = document.createElement("div");
        r.className = "ir";
        r.textContent = "依据：" + String(inf.raw).slice(0, 70);
        r.title = inf.raw;
        box.appendChild(r);
      }
      body.appendChild(box);
    }

    if (waiting === 0) {
      const empty = document.createElement("div");
      empty.className = "rp-empty";
      empty.textContent = "页面上能认出来的字段都填好了 ✓";
      body.appendChild(empty);
    }

    if (pending.length) {
      body.appendChild(makeGroup("插件没填上（" + pending.length + "）"));
      body.appendChild(makeHint("点条目能跳到那个框。写着「选项：」的，是这个下拉里实际能选的项 —— 插件没找到安全匹配的，宁可留空也没乱填。"));
      for (const p of pending) {
        body.appendChild(makeItem(p.label, p.reason, "失败", p.el));
        if (p.options && p.options.length) body.appendChild(makeOptions(p.options));
      }
    }

    if (unknown.length) {
      body.appendChild(makeGroup("页面里没认出来的空白框（" + unknown.length + "）"));
      body.appendChild(makeHint("点右边的「记住」，告诉插件这个框该填什么，以后就自动认出来了。"));
      for (const u of unknown) body.appendChild(makeItem(u.label, u.title, "未识别", u.el, { onRemember: u.onRemember }));
    }

    if (knownEmpty.length) {
      body.appendChild(makeGroup("插件认识、但你的简历里没内容（" + knownEmpty.length + "）"));
      for (const k of knownEmpty) body.appendChild(makeItem(k.label, k.title || "你的简历数据里这个字段是空的", "无数据", k.el));
    }

    reportEl.appendChild(body);

    const undoAction = actions.find(a => a.id === "undo");
    if (undoAction && s.snapshotCount > 0) {
      const foot = document.createElement("div");
      foot.className = "rp-foot";
      const undo = document.createElement("button");
      undo.className = "rp-undo";
      undo.textContent = "↩ 撤销这次填写（恢复 " + s.snapshotCount + " 个框的原值）";
      undo.addEventListener("click", async () => {
        undo.disabled = true;
        undo.textContent = "正在恢复…";
        try { await undoAction.onClick(); } catch (e) { /* onClick 内部已提示 */ }
        undo.disabled = false;
        undo.textContent = "↩ 撤销这次填写（恢复 " + s.snapshotCount + " 个框的原值）";
      });
      foot.appendChild(undo);
      reportEl.appendChild(foot);
    }
  }

  function makeGroup(text) {
    const g = document.createElement("div");
    g.className = "rp-group";
    g.textContent = text;
    return g;
  }

  function makeHint(text) {
    const h = document.createElement("div");
    h.className = "rp-hint";
    h.textContent = text;
    return h;
  }

  // 匹配不上时，把这个控件实际有哪些选项摊开
  function makeOptions(list) {
    const MAX = 24;
    const d = document.createElement("div");
    d.className = "rp-opts";
    const b = document.createElement("b");
    b.textContent = "选项：";
    d.appendChild(b);
    const shown = list.slice(0, MAX).join(" / ");
    d.appendChild(document.createTextNode(shown + (list.length > MAX ? " 等 " + list.length + " 项" : "")));
    d.title = list.join(" / ");
    return d;
  }

  function makeItem(label, hint, tag, el, opts) {
    const o = opts || {};
    // 用 div 而不是 button：条目里还要嵌「记住」按钮，button 套 button 是非法的
    const item = document.createElement("div");
    item.className = "rp-item";
    item.setAttribute("role", "button");
    item.tabIndex = 0;
    if (hint) item.title = hint;

    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = label;

    const rs = document.createElement("span");
    rs.className = "rs";
    rs.textContent = hint ? String(hint).slice(0, 14) : tag;

    const go = document.createElement("span");
    go.className = "go";
    go.textContent = "定位";

    item.appendChild(nm);
    item.appendChild(rs);
    item.appendChild(go);

    if (o.onRemember) {
      const rm = document.createElement("button");
      rm.className = "rm";
      rm.textContent = "记住";
      rm.title = "告诉插件这个框对应简历里的哪个字段，以后自动认出来";
      rm.addEventListener("click", e => {
        e.stopPropagation();
        try { o.onRemember(el, item); } catch (err) { /* onClick 内部已提示 */ }
      });
      item.appendChild(rm);
    }

    item.addEventListener("click", () => locate(el));
    return item;
  }

  function showReport(summary, refs) {
    if (!ensure()) return;
    renderReport(summary, refs);
    reportEl.hidden = false;
    positionReport();
    scheduleAutoHide();
  }

  function positionReport() {
    const r = ballEl.getBoundingClientRect();
    const w = reportEl.offsetWidth;
    const h = reportEl.offsetHeight;
    // 优先放在悬浮球上方；空间不够就翻到下方
    const above = r.top - h - 10;
    const top = above > EDGE ? above : Math.min(r.bottom + 10, window.innerHeight - h - EDGE);
    const left = Math.max(EDGE, Math.min(r.left + BALL_SIZE - w, window.innerWidth - w - EDGE));
    reportEl.style.left = left + "px";
    reportEl.style.top = Math.max(EDGE, top) + "px";
  }

  function hideReport() {
    clearTimeout(state.reportTimer);
    if (reportEl) reportEl.hidden = true;
  }

  function scheduleAutoHide() {
    clearTimeout(state.reportTimer);
    state.reportTimer = setTimeout(() => {
      if (!reportEl || reportEl.hidden) return;
      if (reportEl.matches(":hover")) { scheduleAutoHide(); return; }
      hideReport();
    }, 15000);
  }

  // 把某个控件滚动到视野中间并闪烁一下，帮用户快速找到它
  function locate(el) {
    if (!el || !el.isConnected) { toast("这个输入框已经不在页面上了（可能被页面重新渲染）", "err"); return; }
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    catch (e) { try { el.scrollIntoView(); } catch (e2) { /* ignore */ } }

    if (!flashBackup.has(el)) {
      flashBackup.set(el, { outline: el.style.outline, offset: el.style.outlineOffset });
    }
    el.style.outline = "3px solid #f59e0b";
    el.style.outlineOffset = "2px";
    clearTimeout(el.__jianliFlashTimer);
    el.__jianliFlashTimer = setTimeout(() => {
      const b = flashBackup.get(el);
      el.style.outline = b ? b.outline : "";
      el.style.outlineOffset = b ? b.offset : "";
      flashBackup.delete(el);
    }, 2400);
  }

  // ---------- 点选提示条 ----------

  function showPickBar(text, opts) {
    if (!ensure()) return;
    const o = opts || {};
    pickBarEl.textContent = "";
    const tx = document.createElement("span");
    tx.className = "tx";
    tx.textContent = text;
    pickBarEl.appendChild(tx);
    if (o.onCancel) {
      const cn = document.createElement("button");
      cn.className = "cn";
      cn.textContent = o.cancelText || "取消（Esc）";
      cn.addEventListener("click", () => { try { o.onCancel(); } catch (e) { /* ignore */ } });
      pickBarEl.appendChild(cn);
    }
    pickBarEl.hidden = false;
  }

  function hidePickBar() {
    if (pickBarEl) pickBarEl.hidden = true;
  }

  // ---------- 模态面板 ----------

  function positionModal(el) {
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = Math.max(EDGE, Math.round((window.innerWidth - w) / 2)) + "px";
    el.style.top = Math.max(EDGE, Math.round((window.innerHeight - h) / 2.4)) + "px";
  }

  function showModal(el) {
    const modals = [pickerEl, collectEl].filter(Boolean);
    for (const m of modals) if (m !== el) m.hidden = true;
    openModal = el;
    el.hidden = false;
    el.style.visibility = "hidden";
    positionModal(el);
    el.style.visibility = "";
  }

  function closeModals() {
    for (const m of [pickerEl, collectEl]) if (m) m.hidden = true;
    openModal = null;
  }

  function modalHead(title, onClose) {
    const head = document.createElement("div");
    head.className = "md-head";
    const t = document.createElement("span");
    t.className = "md-title";
    t.textContent = title;
    const x = document.createElement("button");
    x.className = "rp-x";
    x.textContent = "✕";
    x.addEventListener("click", () => { closeModals(); if (onClose) onClose(); });
    head.appendChild(t);
    head.appendChild(x);
    return head;
  }

  function modalSub(text) {
    const d = document.createElement("div");
    d.className = "md-sub";
    d.textContent = text;
    return d;
  }

  function modalFoot(actions) {
    const foot = document.createElement("div");
    foot.className = "md-foot";
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = "md-btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : "");
      b.textContent = a.label;
      if (a.title) b.title = a.title;
      b.addEventListener("click", async () => {
        try { await a.onClick(); }
        catch (e) { toast("操作失败：" + ((e && e.message) || "未知错误"), "err"); }
      });
      foot.appendChild(b);
    }
    return foot;
  }

  /**
   * 字段选择面板：让用户告诉插件「这个框 = 简历里的哪个字段」
   * @param {{title?:string, sub?:string, groups:{title:string, items:{key:string,label:string,hint?:string}[]}[], onPick:(key:string,label:string)=>void, onCancel?:Function}} opts
   */
  function showFieldPicker(opts) {
    if (!ensure()) return;
    const o = opts || {};
    const groups = o.groups || [];

    pickerEl.textContent = "";
    pickerEl.appendChild(modalHead(o.title || "这个框对应简历里的哪个字段？", o.onCancel));
    if (o.sub) pickerEl.appendChild(modalSub(o.sub));

    const sw = document.createElement("div");
    sw.className = "md-search";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "搜索字段名，比如「期望职位」";
    sw.appendChild(input);
    pickerEl.appendChild(sw);

    const body = document.createElement("div");
    body.className = "md-body";
    pickerEl.appendChild(body);

    function render(q) {
      body.textContent = "";
      const kw = String(q || "").trim().toLowerCase();
      let n = 0;
      for (const g of groups) {
        const items = (g.items || []).filter(it =>
          !kw || it.label.toLowerCase().includes(kw) || String(it.key).toLowerCase().includes(kw));
        if (!items.length) continue;
        const gh = document.createElement("div");
        gh.className = "md-group";
        gh.textContent = g.title;
        body.appendChild(gh);
        for (const it of items) {
          n++;
          const b = document.createElement("button");
          b.className = "md-item";
          const nm = document.createElement("span");
          nm.textContent = it.label;
          b.appendChild(nm);
          if (it.hint) {
            const h = document.createElement("span");
            h.className = "kd";
            h.textContent = it.hint;
            b.appendChild(h);
          }
          b.addEventListener("click", () => {
            closeModals();
            if (o.onPick) o.onPick(it.key, it.label);
          });
          body.appendChild(b);
        }
      }
      if (!n) {
        const e = document.createElement("div");
        e.className = "md-empty";
        e.textContent = "没有匹配的字段";
        body.appendChild(e);
      }
    }
    input.addEventListener("input", () => render(input.value));
    render("");

    showModal(pickerEl);
    setTimeout(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 30);
  }

  /**
   * 结果列表面板（已收集的映射、点选结果等）
   * @param {{title:string, sub?:string, items:{label:string, hint?:string}[], actions:{label:string,onClick:Function,primary?:boolean,danger?:boolean,title?:string}[], onClose?:Function}} opts
   */
  function showListPanel(opts) {
    if (!ensure()) return;
    const o = opts || {};

    collectEl.textContent = "";
    collectEl.appendChild(modalHead(o.title || "结果", o.onClose));
    if (o.sub) collectEl.appendChild(modalSub(o.sub));

    const body = document.createElement("div");
    body.className = "md-body";
    const items = o.items || [];
    if (!items.length) {
      const e = document.createElement("div");
      e.className = "md-empty";
      e.textContent = o.emptyText || "还没有内容";
      body.appendChild(e);
    }
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "md-row";
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = it.label;
      row.appendChild(nm);
      if (it.hint) {
        const h = document.createElement("span");
        h.className = "kd";
        h.textContent = it.hint;
        row.appendChild(h);
      }
      body.appendChild(row);
    }
    collectEl.appendChild(body);

    if (o.actions && o.actions.length) collectEl.appendChild(modalFoot(o.actions));
    showModal(collectEl);
  }

  // ---------- 页面内提示卡 ----------

  // 需要用户点头才动手的事（比如「检测到投递成功，要记进台账吗」）走这里。
  // 投递成功页上通常没有表单，HUD 默认不会挂载，所以这里先把它挂起来。
  function showPrompt(opt) {
    const o = opt || {};
    if (!state.ready) mount(true, state.pos);
    if (!ensure()) return false;

    state.promptOnClose = (typeof o.onClose === "function") ? o.onClose : null;
    promptEl.textContent = "";
    promptEl.hidden = false;

    const head = document.createElement("div");
    head.className = "pt-head";
    const title = document.createElement("div");
    title.className = "pt-title";
    title.textContent = o.title || "提示";
    const x = document.createElement("button");
    x.className = "pt-x";
    x.textContent = "✕";
    x.title = "关掉";
    x.addEventListener("click", hidePrompt);
    head.appendChild(title);
    head.appendChild(x);
    promptEl.appendChild(head);

    if (o.text) {
      const tx = document.createElement("div");
      tx.className = "pt-text";
      tx.textContent = o.text;
      promptEl.appendChild(tx);
    }

    const acts = o.actions || [];
    if (acts.length) {
      const row = document.createElement("div");
      row.className = "pt-acts";
      for (const a of acts) {
        const b = document.createElement("button");
        b.className = a.primary ? "pri-btn" : "ghost-btn";
        b.textContent = a.label;
        b.addEventListener("click", () => {
          Promise.resolve()
            .then(() => (typeof a.onClick === "function" ? a.onClick() : null))
            .catch(() => { /* onClick 内部自己提示 */ });
        });
        row.appendChild(b);
      }
      promptEl.appendChild(row);
    }
    return true;
  }

  function hidePrompt() {
    const cb = state.promptOnClose;
    state.promptOnClose = null;
    if (promptEl) {
      promptEl.hidden = true;
      promptEl.textContent = "";
    }
    if (cb) { try { cb(); } catch (e) { /* ignore */ } }
  }

  // ---------- 轻提示 ----------

  function toast(text, kind) {
    // 用户关掉了悬浮球就不要再往页面上冒东西
    if (!state.visible && !state.ready) return;
    if (!ensure()) return;
    toastEl.textContent = text;
    toastEl.className = "toast" + (kind ? " " + kind : "");
    toastEl.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { if (toastEl) toastEl.hidden = true; }, 3400);
  }

  function setBusy(busy) {
    state.busy = !!busy;
    if (isMounted()) ballEl.classList.toggle("busy", state.busy);
  }

  window.JIANLI_HUD = {
    mount,
    isMounted,
    registerAction,
    showReport,
    hideReport,
    hideMenu,
    toast,
    setBusy,
    locate,
    showPrompt,
    hidePrompt,
    showPickBar,
    hidePickBar,
    showFieldPicker,
    showListPanel,
    closeModals
  };
})();
