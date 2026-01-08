/* Improved Targets (improved-targets)
 * Foundry VTT v13
 * Combat-only targeting overlay
 */

const MODULE_ID = "improved-targets";
const FLAG_SCOPE = MODULE_ID;
const FLAG_KEY = "targetsByUser";
const DEBUG = false;

const CONFIG = {
  // If false, players only see the active token connections (same as GM).
  // If true, players also see persistent connections for their other owned combat tokens.
  showPlayerOwnedPersistent: false,
  syncCoreTargets: true
};

const TEST = {
  canvasReadyCalls: 0,
  deleteTokenCalls: 0,
  sanitizeCalls: 0,
  combatEndedCalls: 0
};

function debugLog(...args) {
  if (!DEBUG) return;
  console.log("improved-targets |", ...args);
}

class ImprovedTargets {
  static containers = {
    persistent: null,
    hover: null
  };

  static state = {
    hoveredTokenId: null
  };

  static init() {
    if (this._initialized) return;
    this._initialized = true;

    debugLog("init: registering hooks");

    // Register canvas handler hook immediately (do not depend on ready)
    this._installCanvasPointerHandlers();

    Hooks.on("ready", () => {
      debugLog("hook: ready");
      this._onReady();
    });

    Hooks.on("canvasReady", () => {
      TEST.canvasReadyCalls += 1;
      debugLog("TEST canvasReadyCalls", TEST.canvasReadyCalls);

      debugLog("hook: canvasReady (from init)");
      this._onCanvasReady();

      // GM cleans invalid references after scene is ready
      if (game.combat?.started) this._sanitizeCombatTargets(game.combat);
    });

    Hooks.on("updateCombat", (combat, changed) => {
      if (changed?.started === false) {
        this._onCombatEnded();
        return;
      }
      this._scheduleRedraw();
    });

    Hooks.on("deleteCombat", () => {
      this._onCombatEnded();
    });

    Hooks.on("combatTurnChange", (combat) => {
      if (combat?.started) this._sanitizeCombatTargets(combat);
    });

    Hooks.on("updateCombatant", () => this._scheduleRedraw());
    Hooks.on("deleteCombatant", () => this._scheduleRedraw());
    Hooks.on("updateToken", (tokenDoc, changed) => {
      const moved = Object.prototype.hasOwnProperty.call(changed, "x") || Object.prototype.hasOwnProperty.call(changed, "y");
      if (moved && game.combat?.started) {
        this._scheduleRedrawNextFrame?.() ?? this._scheduleRedraw();
        return;
      }
      this._scheduleRedraw();
    });

    Hooks.on("deleteToken", () => {
      TEST.deleteTokenCalls += 1;
      debugLog("TEST deleteTokenCalls", TEST.deleteTokenCalls);

      if (game.combat?.started) this._sanitizeCombatTargets(game.combat);
      this._scheduleRedraw();
    });

    Hooks.on("hoverToken", (token, hovered) => {
      this.state.hoveredTokenId = hovered ? token?.id ?? null : null;
      this._scheduleRedraw();
    });

    Hooks.on("refreshToken", (token) => {
      if (!game.combat?.started) return;
      ImprovedTargets._scheduleRedraw();
    });
  }

  static _onReady() {
    this._installSocketListener();
    debugLog("_onReady executed");
  }

  static _onCanvasReady() {
    this._ensureOverlayLayers();
    this._scheduleRedraw();
  }

  static _onCombatEnded() {
    TEST.combatEndedCalls += 1;
    debugLog("TEST combatEndedCalls", TEST.combatEndedCalls);

    // Stop drawing immediately for everyone
    this._clearOverlayNow();

    // Each client can only clear their own core targets
    if (CONFIG.syncCoreTargets) this._clearCoreTargets();

    debugLog("combat ended: coreTargetsAfterClear", Array.from(game.user.targets ?? []));
  }

  static async _sanitizeCombatTargets(combat) {
    if (!combat?.started) return;
    if (!game.user.isGM) return;
    if (!canvas?.tokens) return;

    try {
      for (const combatant of combat.combatants) {
        const map = foundry.utils.duplicate(this._getTargetsMap(combatant));
        let changedAny = false;

        for (const [userId, list] of Object.entries(map)) {
          if (!Array.isArray(list) || list.length === 0) continue;

          const filtered = list.filter((id) => canvas.tokens.get(id));

          if (filtered.length !== list.length) {
            debugLog("sanitize changed", {
              combatantId: combatant.id,
              userId,
              before: list,
              after: filtered
            });

            map[userId] = filtered;
            changedAny = true;
          }
        }

        if (changedAny) {
          await combatant.setFlag(FLAG_SCOPE, FLAG_KEY, map);
        }
      }

      this._broadcastRedraw();
    } catch (err) {
      console.error(`${MODULE_ID} | sanitize failed`, err);
    }
  }


  static _installSocketListener() {
    if (this._socketInstalled) return;
    this._socketInstalled = true;

    const channel = `module.${MODULE_ID}`;
    game.socket.on(channel, async (data) => {
      if (!data || !data.type) return;

      if (data.type === "redraw") {
        ImprovedTargets._scheduleRedraw();
        return;
      }

      if (data.type === "requestTargetsUpdate") {
        // Only GM applies authoritative updates
        if (!game.user.isGM) return;
        await ImprovedTargets._applyTargetsUpdateRequest(data);
        return;
      }
    });
  }

  static _emitTargetsUpdateRequest(combatantId, authorUserId, targetTokenIds) {
    const channel = `module.${MODULE_ID}`;
    game.socket.emit(channel, {
      type: "requestTargetsUpdate",
      combatantId,
      authorUserId,
      targetTokenIds
    });
  }

  static async _applyTargetsUpdateRequest(data) {
    if (!this._isCombatStarted()) return;

    const combat = game.combat;
    if (!combat) return;

    const activeCombatant = combat.combatant;
    if (!activeCombatant) return;

    // Enforce: only active combatant may be edited
    if (data.combatantId !== activeCombatant.id) return;

    // Enforce: requester must own the active token (player-side rule)
    const requester = game.users?.get(data.authorUserId);
    const activeTokenDoc = activeCombatant.token;
    if (requester && activeTokenDoc) {
      const isOwner = activeTokenDoc.testUserPermission(requester, CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER);
      if (!isOwner) return;
    }

    // Apply authoritative update on GM
    await this._setUserTargets(activeCombatant, data.authorUserId, Array.isArray(data.targetTokenIds) ? data.targetTokenIds : []);

    // Force everyone to redraw immediately
    this._broadcastRedraw();
  }

  static _broadcastRedraw() {
    const channel = `module.${MODULE_ID}`;
    game.socket.emit(channel, { type: "redraw" });
  }

  /* =========================
   * Gating and authority
   * ========================= */

  static _isCombatStarted() {
    return !!game.combat && !!game.combat.started;
  }

  static _getActiveCombatant() {
    if (!this._isCombatStarted()) return null;
    return game.combat.combatant ?? null;
  }

  static _getActiveToken() {
    const combatant = this._getActiveCombatant();
    return combatant?.token?.object ?? null;
  }

  static _canUserModifyActiveTargets(user, activeToken) {
    if (!this._isCombatStarted()) return false;
    if (!user || !activeToken) return false;

    const combatant = this._getActiveCombatant();
    if (!combatant) return false;

    if (user.isGM === true) {
      // GM can only modify targets on NPC turns (no player owner)
      const actor = combatant.actor;
      const isNpcTurn = actor ? actor.hasPlayerOwner !== true : true;
      return isNpcTurn;
    }

    // Player can only modify targets for the active token they own
    return activeToken.document.isOwner === true;
  }

  /* =========================
   * Data storage (Combatant flags)
   * ========================= */

  static _getTargetsMap(combatant) {
    const map = combatant.getFlag(FLAG_SCOPE, FLAG_KEY);
    return map && typeof map === "object" ? map : {};
  }

  static _getCombatantAuthorUserId(combatant) {
    const map = this._getTargetsMap(combatant);
    for (const [userId, list] of Object.entries(map)) {
      if (Array.isArray(list) && list.length > 0) return userId;
    }
    return null;
  }

  static _getUserTargets(combatant, userId) {
    const map = this._getTargetsMap(combatant);
    const list = map[userId];
    return Array.isArray(list) ? list : [];
  }

  static async _setUserTargets(combatant, userId, tokenIds) {
    const map = foundry.utils.duplicate(this._getTargetsMap(combatant));
    map[userId] = tokenIds;
    await combatant.setFlag(FLAG_SCOPE, FLAG_KEY, map);
  }

  static async _clearUserTargets(combatant, userId) {
    const map = foundry.utils.duplicate(this._getTargetsMap(combatant));
    map[userId] = [];
    await combatant.setFlag(FLAG_SCOPE, FLAG_KEY, map);
  }

  static _getCoreTargetIds() {
    // UserTargets manages token ids; accessor "ids" exists in v13
    return Array.isArray(game.user?.targets?.ids) ? game.user.targets.ids : [];
  }

  static _clearCoreTargets() {
    const ids = this._getCoreTargetIds();
    for (const id of ids) {
      const token = canvas.tokens?.get(id);
      if (!token) continue;
      token.setTarget(false, { releaseOthers: false });
    }
  }

  static _applyCoreTargets(targetTokenIds) {
    this._clearCoreTargets();

    for (const id of targetTokenIds) {
      const token = canvas.tokens?.get(id);
      if (!token) continue;

      // Respect anti-metagame: only set core targets for tokens visible to this user
      if (token.isVisible !== true) continue;

      token.setTarget(true, { releaseOthers: false });
    }
  }

  /* =========================
   * Input handling
   * ========================= */

  static _patchTokenRightClick() {
    const proto = Token?.prototype;
    if (!proto) return;

    const methodName = "_onClickRight";
    if (typeof proto[methodName] !== "function") return;

    const original = proto[methodName];

    proto[methodName] = async function(event) {
      try {
        await ImprovedTargets._handleTokenRightClick(this, event);
      } catch (err) {
        console.error(`${MODULE_ID} | Right-click handler error`, err);
      }
      return original.call(this, event);
    };
  }

  static async _handleTokenRightClick(clickedToken, event) {
    debugLog("handleTokenRightClick: start", {
      clickedTokenId: clickedToken?.id ?? null
    });

    if (!this._isCombatStarted()) return;

    const user = game.user;
    const activeCombatant = this._getActiveCombatant();
    const activeToken = this._getActiveToken();
    if (!activeCombatant || !activeToken) return;

    if (!this._canUserModifyActiveTargets(user, activeToken)) return;

    const isToggle = this._isToggleModifierPressed(event);
    const userId = user.id;

    const current = new Set(this._getUserTargets(activeCombatant, userId));
    const targetTokenId = clickedToken.id;

    if (!isToggle) {
      current.clear();
      current.add(targetTokenId);
    } else {
      if (current.has(targetTokenId)) current.delete(targetTokenId);
      else current.add(targetTokenId);
    }

    const targetsArray = Array.from(current);

    await this._setUserTargets(activeCombatant, userId, targetsArray);

    if (!game.user.isGM) {
      this._emitTargetsUpdateRequest(activeCombatant.id, userId, targetsArray);
    }

    if (CONFIG.syncCoreTargets) {
      this._applyCoreTargets(Array.from(current));
    }

    // Always redraw locally
    this._scheduleRedraw();

    // Broadcast is best-effort, must not break local behavior
    try {
      this._broadcastRedraw();
    } catch (err) {
      console.error(`${MODULE_ID} | broadcast redraw failed`, err);
    }

    debugLog("handleTokenRightClick: saved", {
      userId,
      targets: Array.from(current)
    });
  }

  static _isToggleModifierPressed(event) {
    const originalEvent = event?.data?.originalEvent;
    if (!originalEvent) return false;

    // macOS: Command (metaKey). Windows/Linux: Control (ctrlKey).
    return originalEvent.metaKey === true || originalEvent.ctrlKey === true;
  }

  static _installCanvasPointerHandlers() {
    Hooks.on("canvasReady", () => {
      debugLog("canvasReady: installing pointer handlers");

      if (!canvas?.stage) {
        debugLog("canvasReady: canvas.stage missing");
        return;
      }

      // Ensure stage receives pointer events (Pixi v7+)
      try {
        canvas.stage.eventMode = "static";
      } catch (_) {
        canvas.stage.interactive = true;
      }

      if (!canvas.stage.hitArea && canvas?.app?.renderer?.screen) {
        canvas.stage.hitArea = canvas.app.renderer.screen;
      }

      // Left click clear is handled via pointerdown
      canvas.stage.off("pointerdown", this._onStagePointerDownBound);
      this._onStagePointerDownBound = this._onStagePointerDown.bind(this);
      canvas.stage.on("pointerdown", this._onStagePointerDownBound);

      // Right click targeting is handled via rightdown
      canvas.stage.off("rightdown", this._onStageRightDownBound);
      this._onStageRightDownBound = this._onStageRightDown.bind(this);
      canvas.stage.on("rightdown", this._onStageRightDownBound);

      debugLog("canvasReady: handlers installed");
    });
  }

  static _getTokenFromDisplayObject(displayObject) {
    let obj = displayObject;

    while (obj) {
      // Sometimes the event target is the Token itself
      if (obj instanceof Token) return obj;

      // Sometimes it is a mesh/child that references the Token via .object
      if (obj?.object instanceof Token) return obj.object;

      obj = obj.parent;
    }

    return null;
  }

  static _getEventCanvasPosition(event) {
    const data = event?.data;
    if (!data) return null;

    // Position in world coordinates (same space as token.getBounds())
    const p = data.getLocalPosition(canvas.stage);
    return { x: p.x, y: p.y };
  }

  static _getTokenAtPosition(x, y) {
    const tokens = canvas.tokens?.placeables ?? [];
    if (!tokens.length) return null;

    // Iterate from top to bottom (last drawn is usually "on top")
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      const t = tokens[i];
      if (!t) continue;

      const b = t.getBounds();
      const inside = x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
      if (inside) return t;
    }

    return null;
  }

  static async _onStagePointerDown(event) {
    const originalEvent = event?.data?.originalEvent;
    if (!originalEvent) return;

    // Left click only
    if (originalEvent.button !== 0) return;

    // If you want, keep this debug during testing
    debugLog("pointerdown", {
      button: originalEvent.button,
      ctrlKey: originalEvent.ctrlKey,
      metaKey: originalEvent.metaKey,
      shiftKey: originalEvent.shiftKey,
      altKey: originalEvent.altKey,
      type: originalEvent.type
    });

    if (!this._isCombatStarted()) return;

    const user = game.user;
    const activeCombatant = this._getActiveCombatant();
    const activeToken = this._getActiveToken();
    if (!activeCombatant || !activeToken) return;

    if (!this._canUserModifyActiveTargets(user, activeToken)) return;

    // Only clear when clicking empty canvas (not a token)
    const clickedToken = this._getTokenFromDisplayObject(event?.target);
    if (clickedToken) return;

    debugLog("clearTargets", { userId: user.id });

    await this._clearUserTargets(activeCombatant, user.id);

    if (!user.isGM) {
      this._emitTargetsUpdateRequest(activeCombatant.id, user.id, []);
    }

    debugLog("afterClear flag", activeCombatant.getFlag(FLAG_SCOPE, FLAG_KEY));

    if (CONFIG.syncCoreTargets) {
      this._clearCoreTargets();
    }

    this._scheduleRedraw();

    try {
      this._broadcastRedraw();
    } catch (err) {
      console.error(`${MODULE_ID} | broadcast redraw failed`, err);
    }
  }

  static async _onStageRightDown(event) {
    if (!this._isCombatStarted()) return;

    const originalEvent = event?.data?.originalEvent;
    if (!originalEvent) return;

    debugLog("RIGHTDOWN keys", {
      button: originalEvent.button,
      ctrlKey: originalEvent.ctrlKey,
      metaKey: originalEvent.metaKey,
      shiftKey: originalEvent.shiftKey,
      altKey: originalEvent.altKey,
      type: originalEvent.type
    });

    const user = game.user;
    const activeCombatant = this._getActiveCombatant();
    const activeToken = this._getActiveToken();
    if (!activeCombatant || !activeToken) return;

    const canModify = this._canUserModifyActiveTargets(user, activeToken);
    if (!canModify) return;

    // Try to resolve token from Pixi target first
    let clickedToken = this._getTokenFromDisplayObject(event?.target);

    // Fallback: resolve by canvas position (robust when targetClass is empty)
    if (!clickedToken) {
      const pos = this._getEventCanvasPosition(event);
      if (pos) clickedToken = this._getTokenAtPosition(pos.x, pos.y);
    }

    debugLog("rightdown: resolved token", {
      clickedTokenId: clickedToken?.id ?? null
    });

    if (!clickedToken) return;

    debugLog("RIGHTDOWN resolved token", { clickedTokenId: clickedToken?.id ?? null });

    await this._handleTokenRightClick(clickedToken, event);
  }

  static _displayObjectIsTokenOrChild(displayObject) {
    if (!displayObject) return false;
    let obj = displayObject;
    while (obj) {
      if (obj instanceof Token) return true;
      obj = obj.parent;
    }
    return false;
  }

  /* =========================
   * Rendering
   * ========================= */

  static _ensureOverlayLayers() {
    if (!canvas?.stage) return;

    const parent = canvas.primary ?? canvas.stage;

    if (!this.containers.persistent) {
      this.containers.persistent = new PIXI.Container();
      this.containers.persistent.name = "improved-targets-persistent";
      parent.addChild(this.containers.persistent);
    } else if (this.containers.persistent.parent !== parent) {
      parent.addChild(this.containers.persistent);
    }

    if (!this.containers.hover) {
      this.containers.hover = new PIXI.Container();
      this.containers.hover.name = "improved-targets-hover";
      parent.addChild(this.containers.hover);
    } else if (this.containers.hover.parent !== parent) {
      parent.addChild(this.containers.hover);
    }
  }

  static _scheduleRedraw() {
    if (!canvas?.ready) return;
    if (this._redrawPending) return;
    this._redrawPending = true;

    Promise.resolve().then(() => {
      this._redrawPending = false;
      this.redraw();
    });
  }

  static _scheduleRedrawNextFrame() {
    if (this._nextFrameRedrawQueued) return;
    this._nextFrameRedrawQueued = true;

    const run = () => {
      this._nextFrameRedrawQueued = false;
      this._scheduleRedraw();
    };

    // Prefer Pixi ticker when available
    if (canvas?.app?.ticker?.addOnce) {
      canvas.app.ticker.addOnce(run);
      return;
    }

    requestAnimationFrame(run);
  }

  static redraw() {
    this._ensureOverlayLayers();

    this._clearContainer(this.containers.persistent);
    this._clearContainer(this.containers.hover);

    if (!this._isCombatStarted()) return;

    const combat = game.combat;
    const viewer = game.user;

    const activeCombatant = combat.combatant ?? null;
    const activeTokenId = activeCombatant?.tokenId ?? null;

    // 1) Draw active token connections for everyone (GM and players)
    if (activeCombatant && activeTokenId) {
      const originToken = canvas.tokens?.get(activeTokenId);
      if (originToken) {
        const authorUserId = this._getCombatantAuthorUserId(activeCombatant);
        if (authorUserId) {
          const targets = this._getUserTargets(activeCombatant, authorUserId);

          this._drawConnections({
            container: this.containers.persistent,
            originToken,
            targetTokenIds: targets,
            userId: authorUserId,
            isActiveOrigin: true
          });
        }
      }
    }

    // 2) Optional: draw the viewer player's other owned tokens (non-active) persistently
    if (!viewer.isGM && CONFIG.showPlayerOwnedPersistent) {
      this._drawPlayerNonActiveView(combat, viewer.id, activeTokenId);
    }

    // 3) Hover view (salientes) for hovered token
    this._drawHoverView(combat);
  }

  static _drawGMView(combat, userId, activeTokenId) {
    if (!activeTokenId) return;
    const activeCombatant = combat.combatant;
    if (!activeCombatant) return;

    const originToken = canvas.tokens?.get(activeTokenId);
    if (!originToken) return;

    const targets = this._getUserTargets(activeCombatant, userId);
    this._drawConnections({
      container: this.containers.persistent,
      originToken,
      targetTokenIds: targets,
      userId,
      isActiveOrigin: true
    });
  }

  static _drawPlayerNonActiveView(combat, viewerUserId, activeTokenId) {
    for (const combatant of combat.combatants) {
      const originTokenId = combatant.tokenId;
      if (!originTokenId) continue;
      if (originTokenId === activeTokenId) continue; // already drawn in active pass

      const originToken = canvas.tokens?.get(originTokenId);
      if (!originToken) continue;

      if (originToken.document.isOwner !== true) continue;

      const targets = this._getUserTargets(combatant, viewerUserId);

      this._drawConnections({
        container: this.containers.persistent,
        originToken,
        targetTokenIds: targets,
        userId: viewerUserId,
        isActiveOrigin: false
      });
    }
  }

  static _drawHoverView(combat) {
    const hoveredTokenId = this.state.hoveredTokenId;
    if (!hoveredTokenId) return;

    const hoveredToken = canvas.tokens?.get(hoveredTokenId);
    if (!hoveredToken) return;

    const combatant = combat.combatants.find(c => c.tokenId === hoveredTokenId);
    if (!combatant) return;

    const authorUserId = this._getCombatantAuthorUserId(combatant);
    if (!authorUserId) return;

    const targets = this._getUserTargets(combatant, authorUserId);

    this._drawConnections({
      container: this.containers.hover,
      originToken: hoveredToken,
      targetTokenIds: targets,
      userId: authorUserId,
      isActiveOrigin: false,
      isHover: true
    });
  }

  static _drawConnections({ container, originToken, targetTokenIds, userId, isActiveOrigin, isHover = false }) {
    if (!Array.isArray(targetTokenIds) || targetTokenIds.length === 0) return;

    const userColor = this._getUserColor(userId);
    const thickness = this._getLineThickness({ isActiveOrigin, isHover });

    for (const targetId of targetTokenIds) {
      const targetToken = canvas.tokens?.get(targetId);
      if (!targetToken) continue;

      if (!this._isTokenVisibleForUser(targetToken)) continue;

      if (originToken.id === targetToken.id) {
        this._drawOutline(container, originToken, userColor, thickness, { isAutoTarget: true, isHover });
        continue;
      }

      this._drawLine(container, originToken, targetToken, userColor, thickness, { isHover });
      this._drawOutline(container, originToken, userColor, thickness, { isHover });
      this._drawOutline(container, targetToken, userColor, thickness, { isHover });
    }
  }

  static _drawLine(container, originToken, targetToken, color, thickness, { isHover }) {
    const g = new PIXI.Graphics();
    container.addChild(g);

    const alpha = isHover ? 0.6 : 0.9;

    g.lineStyle(thickness, color, alpha);

    const a = originToken.center;
    const b = targetToken.center;

    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
  }

  static _drawOutline(container, token, color, thickness, { isAutoTarget = false, isHover = false }) {
    const g = new PIXI.Graphics();
    container.addChild(g);

    const outlineAlpha = isHover ? 0.6 : 0.9;
    const fillAlpha = isHover ? 0.5 : 0.8;
    const outlineThickness = Math.max(1, Math.floor(thickness));

    const x = token.document.x;
    const y = token.document.y;
    const w = token.w;
    const h = token.h;

    const gridType = canvas.grid?.type;

    // Fill first
    g.beginFill(color, fillAlpha);

    if (this._isHexGrid(gridType)) {
      const points = this._getHexPoints({ x, y, w, h, gridType });
      g.drawPolygon(points);
    } else {
      g.drawRect(x, y, w, h);
    }

    g.endFill();

    // Then outline
    g.lineStyle(outlineThickness, color, outlineAlpha);

    if (this._isHexGrid(gridType)) {
      const points = this._getHexPoints({ x, y, w, h, gridType });
      g.drawPolygon(points);
    } else {
      g.drawRect(x, y, w, h);
    }

    if (isAutoTarget) {
      // Still only outline+fill, no line is drawn elsewhere for auto-target.
    }
  }

  static _getUserColor(userId) {
    const u = game.users?.get(userId);
    const c = u?.color;

    // Foundry v13 may provide a Color (Number subclass) or a primitive number.
    const asNumber = Number(c);
    if (!Number.isNaN(asNumber) && asNumber !== 0) return asNumber;

    if (typeof c === "string") {
      const s = c.trim().toLowerCase();
      if (s.startsWith("#")) return Number.parseInt(s.slice(1), 16);
      if (s.startsWith("0x")) return Number.parseInt(s.slice(2), 16);
      return Number.parseInt(s, 16);
    }

    return 0xffffff;
  }

  static _getLineThickness({ isActiveOrigin, isHover }) {
    if (isHover) return 2;
    if (isActiveOrigin) return 4;
    return 3;
  }

  static _isTokenVisibleForUser(token) {
    return token?.isVisible === true;
  }

  static _isHexGrid(gridType) {
    const HEX_TYPES = new Set([
      CONST.GRID_TYPES.HEXODDR,
      CONST.GRID_TYPES.HEXEVENR,
      CONST.GRID_TYPES.HEXODDQ,
      CONST.GRID_TYPES.HEXEVENQ
    ]);
    return HEX_TYPES.has(gridType);
  }

  static _getHexPoints({ x, y, w, h, gridType }) {
    const pointyTop = gridType === CONST.GRID_TYPES.HEXODDR || gridType === CONST.GRID_TYPES.HEXEVENR;

    if (pointyTop) {
      return [
        x + w * 0.5, y,
        x + w, y + h * 0.25,
        x + w, y + h * 0.75,
        x + w * 0.5, y + h,
        x, y + h * 0.75,
        x, y + h * 0.25
      ];
    }

    return [
      x + w * 0.25, y,
      x + w * 0.75, y,
      x + w, y + h * 0.5,
      x + w * 0.75, y + h,
      x + w * 0.25, y + h,
      x, y + h * 0.5
    ];
  }

  static _clearContainer(container) {
    if (!container) return;
    container.removeChildren().forEach(child => child.destroy?.({ children: true }));
  }

  static _clearOverlayNow() {
    // Adjust these names to your real containers
    // The key is: removeChildren and force a render update
    if (this._overlayContainer) this._overlayContainer.removeChildren();
    if (this._hoverContainer) this._hoverContainer.removeChildren();
    this._scheduleRedraw();
  }
}

debugLog("module loaded");

ImprovedTargets.init();
