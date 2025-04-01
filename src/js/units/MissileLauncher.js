import { game } from '../core/Game.js';
import { utils } from '../core/utils.js';
import { common } from '../core/common.js';
import {
  bananaMode,
  FPS,
  GAME_SPEED_RATIOED,
  getTypes,
  rndInt,
  rubberChickenMode,
  TYPES
} from '../core/global.js';
import { gamePrefs } from '../UI/preferences.js';
import {
  enemyHelicopterNearby,
  nearbyTest,
  objectInView,
  recycleTest
} from '../core/logic.js';
import { playSound, sounds } from '../core/sound.js';
import { sprites } from '../core/sprites.js';
import { effects } from '../core/effects.js';
import { net } from '../core/network.js';

const MISSILE_LAUNCHER_SCAN_RADIUS = 320;
const MISSILE_LAUNCHER_SCAN_BUFFER = 16;

const spriteWidth = 108;
const spriteHeight = 144;
const frameWidth = spriteWidth;
const frameHeight = spriteHeight / 4;
const width = 54;
const height = 18;
const energy = 8;

const MissileLauncher = (options = {}) => {
  let exports;

  let css, data, dom, domCanvas, friendlyNearby;

  css = common.inheritCSS({
    className: 'missile-launcher',
    exploding: 'exploding',
    scanNode: 'scan-node'
  });

  data = common.inheritData(
    {
      type: 'missile-launcher',
      bottomAligned: true,
      energy,
      energyMax: energy,
      direction: 0,
      vX: options.isEnemy ? -1 : 1,
      frameCount: 0,
      frameTimeout: null,
      fireModulus: FPS, // check every second or so
      fireModulus1X: FPS,
      width,
      logicalWidth: MISSILE_LAUNCHER_SCAN_RADIUS,
      halfWidth: width / 2,
      height,
      halfHeight: height / 2,
      orderComplete: false,
      scanDistance: MISSILE_LAUNCHER_SCAN_RADIUS,
      state: 0,
      stateMax: 3,
      stateModulus: 38,
      stateModulus1X: 38,
      gameSpeedProps: ['fireModulus', 'stateModulus'],
      x: options.x || 0,
      y: game.objects.view.data.world.height - height - 2,
      stepOffset: options.stepOffset,
      domFetti: {
        colorType: options.isEnemy ? 'grey' : 'green',
        elementCount: 7 + rndInt(7),
        startVelocity: 10 + rndInt(10)
      },
      hasScanNode: true
    },
    options
  );

  dom = {
    o: null
  };

  domCanvas = {
    radarItem: MissileLauncher.radarItemConfig(),
    img: {
      src: null,
      source: {
        x: 0,
        y: 0,
        is2X: true,
        width: spriteWidth,
        height: spriteHeight,
        frameWidth,
        frameHeight,
        frameX: 0,
        frameY: 0
      },
      target: {
        width: frameWidth / 2,
        height: frameHeight / 2
      }
    }
  };

  exports = {
    animate: () => animate(exports),
    css,
    data,
    dom,
    domCanvas,
    die: (dieOptions) => die(exports, dieOptions),
    friendlyNearby,
    init: () => initMissileLauncher(options, exports),
    // radarItem,
    refreshSprite: () => refreshSprite(exports),
    resize: () => resize(exports),
    resume: () => resume(exports),
    stop: () => stop(exports)
  };

  exports.friendlyNearby = {
    options: {
      source: exports,
      targets: undefined,
      useLookAhead: true,
      // stop moving if we roll up behind a friendly vehicle
      friendlyOnly: true,
      hit: (target) =>
        common.friendlyNearbyHit(target, exports, {
          resume: exports.resume,
          stop: exports.stop
        }),
      miss: resume
    },
    // who are we looking for nearby?
    items: getTypes('tank, van, missileLauncher', {
      group: 'friendly',
      exports
    }),
    targets: []
  };

  refreshSprite(exports);

  return exports;
};

function refreshSprite(exports) {
  let { domCanvas, data } = exports;
  domCanvas.img.src = utils.image.getImageObject(
    data.isEnemy ? 'missile-launcher-enemy.png' : 'missile-launcher.png'
  );
}

function stop(exports) {
  exports.data.stopped = true;
}

function resume(exports) {
  exports.data.stopped = false;
}

function die(exports, dieOptions = {}) {
  let { css, data, dom, domCanvas, radarItem } = exports;
  if (data.dead) return;

  if (!dieOptions?.silent) {
    utils.css.add(dom.o, css.exploding);

    if (sounds.genericExplosion) {
      playSound(sounds.genericExplosion, exports);
    }

    domCanvas.dieExplosion = effects.genericExplosion(exports);
    domCanvas.img = null;

    effects.inertGunfireExplosion({ exports });

    effects.domFetti(exports, dieOptions.attacker);

    // only cause damage if there was an attacker.
    // otherwise, regular self-destruct case will also stop the missile. ;)
    if (dieOptions.attacker) {
      effects.damageExplosion(exports);
    }

    // account for .scan-node transition time
    common.setFrameTimeout(() => {
      sprites.removeNodesAndUnlink(exports);
    }, 1100);

    if (!dieOptions.firingMissile) {
      common.addGravestone(exports);
      const attackerType = dieOptions.attacker?.data?.type;
      if (
        !net.connected &&
        game.players.local.data.isEnemy === data.isEnemy &&
        gamePrefs.notify_missile_launcher &&
        !data.isOnScreen &&
        attackerType !== TYPES.smartMissile
      ) {
        game.objects.notifications.add('You lost a missile launcher 💥');
      }
    }
  } else {
    sprites.removeNodesAndUnlink(exports);
  }

  // stop moving while exploding
  data.vX = 0;

  data.energy = 0;

  data.dead = true;

  resize(exports);

  radarItem.die(dieOptions);

  common.onDie(exports, dieOptions);
}

function fire(exports) {
  let { data } = exports;
  let i, j, similarMissileCount, targetHelicopter;

  if (data.frameCount % data.fireModulus !== 0) return;

  // is an enemy helicopter nearby?
  targetHelicopter = enemyHelicopterNearby(
    data,
    data.scanDistance + MISSILE_LAUNCHER_SCAN_BUFFER,
    data.hasScanNode
  );

  if (!targetHelicopter) return;

  // we have a possible target. any missiles already chasing it?
  similarMissileCount = 0;

  for (i = 0, j = game.objects[TYPES.smartMissile].length; i < j; i++) {
    if (
      game.objects[TYPES.smartMissile][i].objects.target === targetHelicopter
    ) {
      similarMissileCount++;
    }
  }

  if (similarMissileCount) return;

  /**
   * player's missile launchers: fire and target enemy chopper only when "unattended."
   * e.g., don't fire if a friendly turret or helicopter is nearby; they can handle it.
   * CPU makes missile launchers routinely, whereas they're strategic for human player.
   * in the enemy case, fire at player regardless of who's nearby. makes game tougher.
   */

  if (!data.isEnemy) {
    // friendly turret
    if (
      objectInView(data, {
        triggerDistance: data.scanDistance,
        items: TYPES.turret,
        friendlyOnly: true
      })
    ) {
      return;
    }

    // friendly helicopter, and armed with at least one missile
    if (
      objectInView(data, {
        triggerDistance: data.scanDistance,
        items: TYPES.helicopter,
        friendlyOnly: true
      }) &&
      game.players.local.data.smartMissiles > 0
    ) {
      return;
    }
  }

  // self-destruct, FIRE ZE MISSILE
  die(exports, { firingMissile: true });

  const params = {
    id: `${data.id}_missile`,
    staticID: true,
    parent: exports,
    parentType: data.type,
    isEnemy: data.isEnemy,
    isBanana:
      gamePrefs.alt_smart_missiles &&
      game.objects.view.data.missileMode === bananaMode,
    isRubberChicken:
      gamePrefs.alt_smart_missiles &&
      game.objects.view.data.missileMode === rubberChickenMode,
    x: data.x + data.width / 2,
    y: data.y,
    target: targetHelicopter
  };

  const missile = game.addObject(TYPES.smartMissile, params);

  /**
   * For consistency, ensure a missile exists on both sides.
   *
   * It's possible, given lag(?), that one missile launcher may have been blown up
   * on the other side by something else before it had a chance to launch.
   *
   * This is bad as it could mean your helicopter mysteriously gets hit, when
   * the active missile on the other side hits it.
   */
  if (net.active) {
    net.sendMessage({
      type: 'ADD_OBJECT',
      objectType: missile.data.type,
      params
    });
  }
}

function animate(exports) {
  let { data, dom, domCanvas } = exports;
  data.frameCount++;

  const fpsMultiplier = 1 / GAME_SPEED_RATIOED;

  if (!data.stopped) {
    sprites.moveTo(exports, data.x + data.vX * GAME_SPEED_RATIOED, data.y);
  } else {
    // if stopped, just take scroll into effect
    sprites.moveWithScrollOffset(exports);
  }

  domCanvas?.dieExplosion?.animate();

  if (data.dead) return !dom.o;

  effects.smokeRelativeToDamage(exports);

  if (data.orderComplete && !data.stopped) {
    // regular timer or back wheel bump
    if (data.frameCount % data.stateModulus === 0) {
      data.state++;

      if (data.state > data.stateMax) {
        data.state = 0;
      }

      // reset frameCount (timer)
      data.frameCount = 0;

      // first wheel, delay, then a few frames until we animate the next two.
      if (data.state === 1 || data.state === 3) {
        data.stateModulus = 36 * fpsMultiplier;
      } else {
        data.stateModulus = 4 * fpsMultiplier;
      }

      if (domCanvas.img) {
        domCanvas.img.source.frameY = data.state;
      }
    } else if (
      data.frameCount % data.stateModulus === 2 * fpsMultiplier &&
      data.isOnScreen
    ) {
      // next frame - reset.
      if (domCanvas.img) {
        domCanvas.img.source.frameY = 0;
      }
    }
  }

  recycleTest(exports);

  // (maybe) fire?
  fire(exports);

  if (gamePrefs.ground_unit_traffic_control) {
    nearbyTest(exports.friendlyNearby, exports);
  }

  return data.dead && !dom.o;
}

function resize(exports) {
  return common.resizeScanNode(
    exports,
    exports.radarItem,
    exports.css.className
  );
}

function initDOM(exports) {
  let { css, data, dom } = exports;
  dom.o = sprites.create({
    className: game.objects.editor ? css.className : 'placeholder',
    id: data.id,
    isEnemy: data.isEnemy ? css.enemy : false
  });

  dom.oScanNode = document.createElement('div');
  dom.oScanNode.className = css.scanNode;
  dom.o.appendChild(dom.oScanNode);

  sprites.setTransformXY(exports, dom.o, `${data.x}px`, `${data.y}px`);
}

function initMissileLauncher(options, exports) {
  if (options.noInit) return;

  let { data, dom } = exports;

  initDOM(exports);

  common.initNearby(exports.friendlyNearby, exports);

  data.frameTimeout = common.setFrameTimeout(() => {
    data.orderComplete = true;
    data.frameTimeout = null;
  }, 2000);

  common.setFrameTimeout(() => {
    if (data.dead) return;
    resize(exports);
  }, 150);

  exports.radarItem = game.objects.radar.addItem(
    exports,
    game.objects.editor
      ? dom.o.className
      : data.isEnemy
        ? 'scan-node enemy'
        : 'scan-node'
  );

  // missile launchers also get a scan node.
  exports.radarItem.initScanNode();
}

MissileLauncher.radarItemConfig = () => ({
  width: 4,
  height: 2.5,
  excludeFillStroke: true,
  draw: (ctx, obj, pos, width, height) => {
    const left = pos.left(obj.data.left);
    const top = pos.bottomAlign(height, obj);
    const topHalf = pos.bottomAlign(height / 2, obj);
    const scaledWidth = pos.width(width);
    const scaledHeight = pos.height(height);

    ctx.beginPath();

    ctx.rect(left, topHalf, scaledWidth, scaledHeight / 2);
    ctx.fill();
    ctx.stroke();

    // don't draw a missile if we don't have one - i.e., just launched. ;)
    if (obj?.oParent?.data?.dead) return;

    ctx.beginPath();

    // missile (angled)
    common.domCanvas.rotate(
      ctx,
      obj.oParent.data.isEnemy ? 20 : -20,
      left,
      top,
      scaledWidth / 2,
      scaledHeight / 2
    );

    const missileWidth = pos.width(2.75);
    const missileHeight = pos.height(0.5);

    ctx.roundRect(
      left + (obj.oParent.data.isEnemy ? scaledWidth / 4 : 0),
      top + (obj.oParent.data.isEnemy ? 0 : height),
      missileWidth,
      missileHeight,
      missileWidth
    );

    common.domCanvas.unrotate(ctx);

    ctx.fill();
    ctx.stroke();
  }
});

export { MISSILE_LAUNCHER_SCAN_RADIUS, MissileLauncher };
