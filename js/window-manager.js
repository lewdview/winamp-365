/**
 * ============================================================================
 * WINAMP 365 - MODULAR WINDOW MANAGER & MAGNETIC DOCKING ENGINE
 * Magnetic edge snapping (15px threshold), cluster dragging, window shade mode,
 * responsive bounds, and layout reset support.
 * ============================================================================
 */

export class WindowManager {
  constructor() {
    this.windows = new Map(); // id -> { el, x, y, w, h, isShaded, isVisible }
    this.dockConnections = new Map(); // id -> Set of docked window IDs
    this.activeWindow = null;
    this.zIndexCounter = 100;
    this.snapThreshold = 14; // pixels

    this.dragState = null;
  }

  init() {
    const windowEls = document.querySelectorAll('.winamp-window');
    windowEls.forEach(el => {
      const id = el.id;
      const rect = el.getBoundingClientRect();
      const left = parseInt(el.style.left || rect.left, 10) || 12;
      const top = parseInt(el.style.top || rect.top, 10) || 12;

      this.windows.set(id, {
        id,
        el,
        x: left,
        y: top,
        w: el.offsetWidth,
        h: el.offsetHeight,
        isShaded: false,
        isVisible: true
      });

      this.dockConnections.set(id, new Set());
      this.attachWindowListeners(el);
    });

    this.loadSavedPositions();
    this.updateDockingState();

    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    window.addEventListener('mouseup', () => this.onMouseUp());
  }

  attachWindowListeners(windowEl) {
    const id = windowEl.id;
    const titlebar = windowEl.querySelector('.window-titlebar');

    windowEl.addEventListener('mousedown', () => {
      this.bringToFront(id);
    });

    if (titlebar) {
      titlebar.addEventListener('mousedown', (e) => {
        if (e.target.closest('.win-btn')) return; // Ignore buttons
        this.startDrag(id, e);
      });

      titlebar.addEventListener('dblclick', (e) => {
        if (e.target.closest('.win-btn')) return;
        this.toggleWindowShade(id);
      });
    }

    // Shade Button
    const shadeBtn = windowEl.querySelector('.win-btn-shade');
    if (shadeBtn) {
      shadeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleWindowShade(id);
      });
    }

    // Close Button
    const closeBtn = windowEl.querySelector('.win-btn-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.hideWindow(id);
      });
    }
  }

  bringToFront(id) {
    const win = this.windows.get(id);
    if (!win) return;
    this.zIndexCounter += 2;
    win.el.style.zIndex = this.zIndexCounter;
    this.activeWindow = id;

    document.querySelectorAll('.winamp-window').forEach(el => el.classList.remove('active-window'));
    win.el.classList.add('active-window');
  }

  startDrag(id, mouseEvent) {
    const win = this.windows.get(id);
    if (!win) return;

    this.bringToFront(id);

    // Find all connected cluster windows that should move together
    const cluster = this.getConnectedCluster(id);
    const startPositions = new Map();

    cluster.forEach(winId => {
      const w = this.windows.get(winId);
      startPositions.set(winId, { x: w.x, y: w.y });
    });

    this.dragState = {
      primaryId: id,
      startX: mouseEvent.clientX,
      startY: mouseEvent.clientY,
      cluster,
      startPositions
    };
  }

  onMouseMove(e) {
    if (!this.dragState) return;

    const deltaX = e.clientX - this.dragState.startX;
    const deltaY = e.clientY - this.dragState.startY;

    let targetX = this.dragState.startPositions.get(this.dragState.primaryId).x + deltaX;
    let targetY = this.dragState.startPositions.get(this.dragState.primaryId).y + deltaY;

    // Constrain within visible bounds
    targetX = Math.max(0, Math.min(window.innerWidth - 60, targetX));
    targetY = Math.max(0, Math.min(window.innerHeight - 30, targetY));

    // Magnetic Snapping check against non-moving windows
    const snapResult = this.calculateMagneticSnap(this.dragState.primaryId, targetX, targetY);
    const finalDeltaX = snapResult.x - this.dragState.startPositions.get(this.dragState.primaryId).x;
    const finalDeltaY = snapResult.y - this.dragState.startPositions.get(this.dragState.primaryId).y;

    // Move all windows in the connected cluster
    this.dragState.cluster.forEach(winId => {
      const w = this.windows.get(winId);
      const startPos = this.dragState.startPositions.get(winId);
      w.x = Math.max(0, startPos.x + finalDeltaX);
      w.y = Math.max(0, startPos.y + finalDeltaY);
      w.el.style.left = `${w.x}px`;
      w.el.style.top = `${w.y}px`;
    });
  }

  onMouseUp() {
    if (this.dragState) {
      this.dragState = null;
      this.updateDockingState();
      this.savePositions();
    }
  }

  // Calculate magnetic snapping against other windows
  calculateMagneticSnap(draggingId, testX, testY) {
    const draggingWin = this.windows.get(draggingId);
    let snappedX = testX;
    let snappedY = testY;
    const dW = draggingWin.el.offsetWidth;
    const dH = draggingWin.el.offsetHeight;

    this.windows.forEach((otherWin, otherId) => {
      if (this.dragState.cluster.has(otherId) || !otherWin.isVisible) return;

      const oX = otherWin.x;
      const oY = otherWin.y;
      const oW = otherWin.el.offsetWidth;
      const oH = otherWin.el.offsetHeight;

      // 1. Horizontal Snapping (Left edge to Right edge, Right to Left, Left to Left)
      if (Math.abs(testX - (oX + oW)) < this.snapThreshold) snappedX = oX + oW; // Snap to right of other
      else if (Math.abs((testX + dW) - oX) < this.snapThreshold) snappedX = oX - dW; // Snap to left of other
      else if (Math.abs(testX - oX) < this.snapThreshold) snappedX = oX; // Align lefts
      else if (Math.abs((testX + dW) - (oX + oW)) < this.snapThreshold) snappedX = oX + oW - dW; // Align rights

      // 2. Vertical Snapping (Top to Bottom, Bottom to Top, Top to Top)
      if (Math.abs(testY - (oY + oH)) < this.snapThreshold) snappedY = oY + oH; // Snap below other
      else if (Math.abs((testY + dH) - oY) < this.snapThreshold) snappedY = oY - dH; // Snap above other
      else if (Math.abs(testY - oY) < this.snapThreshold) snappedY = oY; // Align tops
      else if (Math.abs((testY + dH) - (oY + oH)) < this.snapThreshold) snappedY = oY + oH - dH; // Align bottoms
    });

    return { x: snappedX, y: snappedY };
  }

  // Update which windows are docked together based on current edges
  updateDockingState() {
    this.dockConnections.forEach(set => set.clear());

    const winList = Array.from(this.windows.values()).filter(w => w.isVisible);

    for (let i = 0; i < winList.length; i++) {
      for (let j = i + 1; j < winList.length; j++) {
        const a = winList[i];
        const b = winList[j];
        const aW = a.el.offsetWidth;
        const aH = a.el.offsetHeight;
        const bW = b.el.offsetWidth;
        const bH = b.el.offsetHeight;

        const touchingHoriz = (Math.abs(a.x + aW - b.x) <= 3 || Math.abs(b.x + bW - a.x) <= 3) &&
                              (a.y < b.y + bH && a.y + aH > b.y);

        const touchingVert = (Math.abs(a.y + aH - b.y) <= 3 || Math.abs(b.y + bH - a.y) <= 3) &&
                             (a.x < b.x + bW && a.x + aW > b.x);

        if (touchingHoriz || touchingVert) {
          this.dockConnections.get(a.id).add(b.id);
          this.dockConnections.get(b.id).add(a.id);
        }
      }
    }
  }

  // Find all connected windows recursively
  getConnectedCluster(startId) {
    const cluster = new Set();
    const queue = [startId];

    while (queue.length > 0) {
      const current = queue.shift();
      if (!cluster.has(current)) {
        cluster.add(current);
        const neighbors = this.dockConnections.get(current) || [];
        neighbors.forEach(n => {
          if (!cluster.has(n)) queue.push(n);
        });
      }
    }
    return cluster;
  }

  toggleWindowShade(id) {
    const win = this.windows.get(id);
    if (!win) return;
    win.isShaded = !win.isShaded;
    win.el.classList.toggle('shade-mode', win.isShaded);
    this.updateDockingState();
    this.savePositions();
  }

  showWindow(id) {
    const win = this.windows.get(id);
    if (!win) return;
    win.isVisible = true;
    win.el.style.display = 'block';
    this.bringToFront(id);
    this.updateDockingState();
  }

  hideWindow(id) {
    const win = this.windows.get(id);
    if (!win) return;
    win.isVisible = false;
    win.el.style.display = 'none';
    this.updateDockingState();
  }

  toggleWindow(id) {
    const win = this.windows.get(id);
    if (!win) return;
    if (win.isVisible) this.hideWindow(id);
    else this.showWindow(id);
  }

  resetLayout() {
    localStorage.removeItem('winamp365_window_state');
    const defaultPos = {
      'window-main': { x: 12, y: 12, isShaded: false, isVisible: true },
      'window-eq': { x: 12, y: 162, isShaded: false, isVisible: true },
      'window-playlist': { x: 12, y: 304, isShaded: false, isVisible: true },
      'window-visualizer': { x: 290, y: 12, isShaded: false, isVisible: true }
    };

    Object.keys(defaultPos).forEach(id => {
      const pos = defaultPos[id];
      const win = this.windows.get(id);
      if (win) {
        win.x = pos.x;
        win.y = pos.y;
        win.isShaded = false;
        win.isVisible = true;
        win.el.style.left = `${pos.x}px`;
        win.el.style.top = `${pos.y}px`;
        win.el.style.display = 'block';
        win.el.classList.remove('shade-mode');
      }
    });

    this.updateDockingState();
    this.savePositions();
  }

  savePositions() {
    const state = {};
    this.windows.forEach((win, id) => {
      state[id] = {
        x: win.x,
        y: win.y,
        isShaded: win.isShaded,
        isVisible: win.isVisible
      };
    });
    try {
      localStorage.setItem('winamp365_window_state', JSON.stringify(state));
    } catch (e) {
      console.warn('Window state save note:', e);
    }
  }

  loadSavedPositions() {
    try {
      const raw = localStorage.getItem('winamp365_window_state');
      if (!raw) {
        this.resetLayout();
        return;
      }
      const state = JSON.parse(raw);

      Object.keys(state).forEach(id => {
        const saved = state[id];
        const win = this.windows.get(id);
        if (win && saved) {
          win.x = saved.x;
          win.y = saved.y;
          win.isShaded = !!saved.isShaded;
          win.isVisible = saved.isVisible !== false;

          win.el.style.left = `${win.x}px`;
          win.el.style.top = `${win.y}px`;
          if (win.isShaded) win.el.classList.add('shade-mode');
          if (!win.isVisible) win.el.style.display = 'none';
        }
      });
    } catch (e) {
      console.warn('Window state load note:', e);
    }
  }
}
